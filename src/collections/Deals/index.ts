import { CollectionConfig } from 'payload'
import { addDataAndFileToRequest } from 'payload'

/**
 * Selects a destination URL from a list based on weighted probability.
 * A destination with a higher weight has a higher chance of being selected.
 * @param destinations - An array of destination objects.
 * @returns The URL of the selected destination, or null/undefined if no valid destination is found.
 */
export function selectWeightedDestination(
  // FIX: The type now correctly reflects the data from Payload,
  // allowing `weight` and `label` to be `null` and including the optional `id`.
  destinations: Array<{
    url: string
    weight?: number | null
    label?: string | null
    id?: string | null
  }>,
): string | null | undefined {
  if (!destinations) {
    return null
  }

  let selectedUrl: string | null | undefined = null
  let totalWeight = 0

  for (const dest of destinations) {
    // Use a default weight of 1 if not provided or if it's null.
    // The `??` operator correctly handles both null and undefined.
    const weight = dest.weight ?? 1
    if (weight <= 0) {
      continue
    }

    // The probability of replacing the current selection with this destination
    // is equal to its weight divided by the current total weight.
    // This is a form of weighted reservoir sampling.
    if (Math.random() * (totalWeight + weight) < weight) {
      selectedUrl = dest.url
    }

    totalWeight += weight
  }

  // If no destination was selected (e.g., all had zero weight),
  // fall back to the first available URL as a sensible default.
  if (!selectedUrl && destinations.length > 0) {
    return destinations[0].url
  }


  return selectedUrl
}

export const Deals: CollectionConfig = {
  slug: 'deals',
  admin: {
    description: 'Manage your cloaked links for redirects, supporting multiple weighted destinations.',
  },
  access: {
    read: () => true, // Publicly readable for the endpoint to work
  },
  fields: [
    {
      name: 'slug',
      label: 'Cloaked Slug (e.g., /go/product-name)',
      type: 'text',
      unique: true,
      required: true,
      index: true,
      hooks: {
        beforeValidate: [
          ({ value }) => {
            // Ensure the slug always starts with /go/
            if (typeof value === 'string' && !value.startsWith('/go/')) {
              // A simple way to sanitize the slug further
              const sanitizedSlug = value.replace(/^\//, '').replace(/\s+/g, '-')
              return '/go/' + sanitizedSlug
            }
            return value
          },
        ],
      },
      validate: (val: string | null | undefined) => {
        if (typeof val === 'string' && !val.startsWith('/go/')) {
          return 'Slug must start with /go/.'
        }
        return true
      },
    },
    {
      name: 'destinationURLs',
      label: 'Destination URLs',
      type: 'array',
      minRows: 1,
      required: true,
      fields: [
        {
          name: 'url',
          label: 'URL',
          type: 'text',
          required: true,
          validate: (val: string | null | undefined) => {
            if (
              typeof val === 'string' &&
              !val.startsWith('http://') &&
              !val.startsWith('https://')
            ) {
              return 'URL must start with http:// or https://'
            }
            return true
          },
        },
        {
          name: 'weight',
          label: 'Weight (for A/B testing or rotation)',
          type: 'number',
          min: 0,
          defaultValue: 1,
          admin: {
            description: 'Higher weight means a higher chance of being selected for redirection.',
          },
        },
        {
          name: 'label',
          label: 'Label (for internal reference)',
          type: 'text',
        },
      ],
    },
    {
      name: 'trackingData',
      label: 'Tracking Data (JSON)',
      type: 'json',
      admin: {
        description: 'Optional: Add any additional data for tracking purposes.',
      },
    },
  ],
  endpoints: [
    {
      path: '/go/:slug',
      method: 'get',
      // The handler now explicitly returns a Promise<Response>
      handler: async (req): Promise<Response> => {
        await addDataAndFileToRequest(req)
        // Extract slug from URL parameters
        const {slug } = req.routeParams

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
}
