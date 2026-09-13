/** Free Unsplash architectural photos (not from the reference mockups). */
export const photos = {
  splash:
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
  campus:
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  lobby:
    'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  unit:
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80',
  amenity:
    'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1000&q=80',
  pool:
    'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1000&q=80',
  parking:
    'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1000&q=80',
  night:
    'https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1200&q=80',
} as const

export function photoForType(type: string, name = '') {
  const t = `${type} ${name}`.toLowerCase()
  if (t.includes('pool')) return photos.pool
  if (t.includes('gym') || t.includes('fitness')) return photos.amenity
  if (t.includes('park')) return photos.parking
  if (t.includes('lobby') || t.includes('leas') || t.includes('office') || t.includes('club'))
    return photos.lobby
  return photos.unit
}
