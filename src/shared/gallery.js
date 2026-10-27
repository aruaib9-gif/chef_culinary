// Gallery categories, and the photos the site shipped with. The built-in photos are copied into the database the
// first time the gallery is used, so admins can caption, reorder, hide or delete them like their own uploads.
export const galleryCategories = {
  classes: 'Classes',
  dishes: 'Student dishes',
  graduation: 'Graduations',
  events: 'Events',
}

export const builtInPhotos = [
  { src: '/images/IMG_1663.JPG', category: 'events', caption: 'Chefs at a cooking demonstration' },
  { src: '/images/Chef1.jpg', category: 'classes', caption: 'Students cooking in a practical class' },
  { src: '/images/chef2.jpg', category: 'dishes', caption: 'A spread of dishes prepared at the academy' },
  { src: '/images/IMG_1665.JPG', category: 'classes', caption: 'Chef instructor in the academy kitchen' },
  { src: '/images/chef3.jpg', category: 'graduation', caption: 'Graduates celebrating with their certificates' },
  { src: '/images/IMG_1666.JPG', category: 'classes', caption: 'Two trainee chefs in the teaching kitchen' },
  { src: '/images/IMG_1672.JPG', category: 'events', caption: 'A cohort of chefs at a cooking demonstration' },
  { src: '/images/IMG_1668.JPG', category: 'classes', caption: 'A graduate chef in front of the academy mural' },
  { src: '/images/IMG_1671.JPG', category: 'classes', caption: 'A cohort of chefs at a class session' },
  { src: '/images/IMG_1664.JPG', category: 'events', caption: 'A full cohort of chefs at the academy' },
  { src: '/images/IMG_1667.JPG', category: 'classes', caption: 'Instructors and students at the academy' },
  { src: '/images/IMG_1669.JPG', category: 'classes', caption: 'A chef at the academy service counter' },
  { src: '/images/IMG_1670.JPG', category: 'classes', caption: 'A chef at a cooking station' },
]
