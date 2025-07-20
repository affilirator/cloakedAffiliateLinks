// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
//hard-reset

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Deals, selectWeightedDestination } from './collections/Deals'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Deals],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,
  endpoints: [
      {
        path: '/go/:slug',
        method: 'get',
        // The handler now explicitly returns a Promise<Response>
        handler: async (req): Promise<Response> => {
          await addDataAndFileToRequest(req)
          // Extract slug from URL parameters
          const { slug } = req.routeParams
  
          try {
            const result = await req.payload.find({
              collection: 'deals',
              where: {
                slug: {
                  equals: `/go/${slug}`,
                },
              },
              select: {
                // Only fetch the fields you need
                slug: true,
                destinationURLs: true,
              },
              limit: 1,
              depth: 0,
            })
  
            if (result.docs.length > 0) {
              const cloakedLinkDoc = result.docs[0]
              const destinationURLs = cloakedLinkDoc.destinationURLs
  
              if (destinationURLs && destinationURLs.length > 0) {
                const selectedDestinationURL = selectWeightedDestination(destinationURLs)
  
                if (selectedDestinationURL) {
                  // Optional: Implement tracking logic here
                  // Note: If you update the doc, ensure it's awaited before redirecting.
                  // const updatedDoc = await req.payload.update({ ... });
  
                  // Construct and return a redirect Response
                  // Use 302 (Found) for temporary redirect, which is good for rotation/A/B testing.
                  // Use 301 (Moved Permanently) if the redirect is static and permanent.
                  return Response.redirect(selectedDestinationURL, 302)
                } else {
                  console.warn(`No valid destination URL found for cloaked link slug: /go/${slug}`)
                  return new Response('No valid destination URL configured for this link.', {
                    status: 500,
                  })
                }
              } else {
                console.warn(`Cloaked link slug: /go/${slug} has no destination URLs configured.`)
                return new Response('No destination URLs configured for this link.', { status: 404 })
              }
            } else {
              // Link not found
              return new Response('Link not found', { status: 404 })
            }
          } catch (error) {
            console.error('Error handling cloaked link redirect:', error)
            return new Response('Internal Server Error', { status: 500 })
          }
        },
      },
    ],
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
})
