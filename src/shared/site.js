// Organisation details. Will move to admin-editable settings once the API exists (spec §4.2, §9.5).
export const site = {
  name: 'The Chefs Culinary Academy',
  legalName: 'The Chefs Culinary Arts Ltd Academy',
  address: 'No. 17 Chimatem Complex, Psychiatric Road, Rumigbo/Rumuola, Port Harcourt',
  landmark: 'Along Ohiamini/Psychiatric Road, beside Wingate Hotel',
  tagline: 'Quality Chefs, Healthy Life',
  affiliations: 'Affiliated with SUPA ITF and an accredited NABTEB centre',
  phone: '08117248206',
  phoneIntl: '2348117248206',
  emails: ['thechefsculinary@gmail.com', 'chefacademyphc@gmail.com'],
  whatsappMessage: "Hello, I'd like to know more about your culinary programmes.",
  social: {
    facebook: 'https://www.facebook.com/share/1FNjohCnm1/',
    instagram: 'https://www.instagram.com/thechefsculinaryphc',
    youtube: '',
    tiktok: '',
    x: '',
    linkedin: '',
  },
}

export const whatsappUrl = `https://wa.me/${site.phoneIntl}?text=${encodeURIComponent(site.whatsappMessage)}`
