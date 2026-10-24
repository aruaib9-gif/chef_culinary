// Organisation details. Will move to admin-editable settings once the API exists (spec §4.2, §9.5).
export const site = {
  name: 'The Chefs Culinary Academy',
  legalName: 'The Chefs Culinary Arts Ltd Academy',
  address: 'Chimatem Complex, Psychiatric Road, Rumigbo/Rumuola, Port Harcourt',
  phone: '08117248206',
  phoneIntl: '2348117248206',
  emails: ['thechefsculinary@gmail.com', 'chefacademyphc@gmail.com'],
  whatsappMessage: "Hello, I'd like to know more about your culinary programmes.",
  // TODO: replace these with the academy's real profile URLs.
  social: {
    facebook: 'https://facebook.com/',
    instagram: 'https://instagram.com/',
    youtube: '',
    tiktok: 'https://tiktok.com/',
    x: '',
    linkedin: '',
  },
}

export const whatsappUrl = `https://wa.me/${site.phoneIntl}?text=${encodeURIComponent(site.whatsappMessage)}`
