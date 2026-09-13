export type TourFeedback = {
  rating: number
  interestUnits: string[]
  interestAmenities: string[]
  comments: string
  contactOptIn: boolean
  email?: string
}

export async function submitTourFeedback(payload: TourFeedback): Promise<{ ok: true; id: string }> {
  await new Promise((r) => setTimeout(r, 700))
  // Mock persist — payload shape matches Firebase tour_feedback fields
  void payload
  return { ok: true, id: `fb_${crypto.randomUUID().slice(0, 8)}` }
}
