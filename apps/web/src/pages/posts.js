// Editorial content for the News / blog. Evergreen chef tips and recipes authored
// for the academy. The academy can add dated announcements here (or via a CMS) later.
// `category`: 'tips' | 'recipes'

export const postCategories = {
  tips: 'Chef tips',
  recipes: 'Recipes',
}

export const posts = [
  {
    slug: 'knife-skills-beginners',
    category: 'tips',
    title: '5 knife skills every beginner should master',
    excerpt: 'Confidence in the kitchen starts with the knife. Here are the cuts and habits to practise first.',
    readMins: 4,
    body: [
      'Your knife is the tool you will reach for more than any other, so getting comfortable with it early pays off for the rest of your cooking life. Before worrying about speed, focus on control and safety.',
      'Start with the grip: pinch the blade just in front of the handle with your thumb and forefinger, and wrap the rest of your fingers around the handle. Your other hand forms the "claw" — fingertips tucked under, knuckles guiding the blade.',
      'Then practise the core cuts: the slice, the dice, the julienne (thin matchsticks), the chiffonade (fine ribbons of leaves) and the mince. Work slowly and evenly — uniform pieces cook at the same rate, which is the whole point.',
      'Finally, look after your blade. A sharp knife is safer than a dull one because it does the work for you, and a quick hone before each session keeps it true.',
    ],
  },
  {
    slug: 'food-costing-for-profit',
    category: 'tips',
    title: 'How to cost a dish for profit',
    excerpt: 'A great dish that loses money will not keep a kitchen open. Learn the simple maths behind pricing.',
    readMins: 5,
    body: [
      'Costing is the difference between a hobby and a business. Every dish you sell should cover its ingredients, a share of your overheads, and still leave a profit.',
      'Begin with the recipe cost: list every ingredient and the exact quantity used, then price each from what you actually paid. Divide by the number of portions to get your cost per plate.',
      'A common target is a food cost of around 25–35% of the selling price, though this varies by concept. If a plate costs you ₦1,000 in ingredients and you aim for a 30% food cost, you would price it near ₦3,300.',
      'Do not forget portioning and waste. Weighing portions keeps costs predictable, and tracking trimmings and spoilage shows where money is quietly leaking out of the kitchen.',
    ],
  },
  {
    slug: 'food-hygiene-basics',
    category: 'tips',
    title: 'Keeping your kitchen safe: food hygiene basics',
    excerpt: 'Good food is safe food. The habits that protect your customers — and your reputation.',
    readMins: 3,
    body: [
      'Food safety is not glamorous, but it is the foundation every professional kitchen is built on. A single lapse can make people ill and close a business.',
      'The essentials are simple and non-negotiable: wash your hands often and properly, keep raw and cooked foods apart to avoid cross-contamination, cook foods to safe temperatures, and chill perishables promptly.',
      'Clean as you go. A tidy station is a safe station, and it is far easier to keep a kitchen clean than to rescue one that has fallen behind. Colour-coded boards, labelled containers and a cleaning schedule all help.',
    ],
  },
  {
    slug: 'mise-en-place',
    category: 'tips',
    title: 'Mise en place: why prep wins',
    excerpt: '“Everything in its place.” The professional habit that makes service calm instead of chaotic.',
    readMins: 3,
    body: [
      'Mise en place is a French phrase that means "everything in its place" — and it is the single habit that separates calm kitchens from chaotic ones.',
      'Before you turn on the heat, read the whole recipe, then measure, chop and arrange every ingredient within reach. When the cooking starts, you are assembling rather than scrambling.',
      'The same discipline applies to tools and timing. Have your pans, spoons and towels ready, and think through the order of steps so nothing overcooks while you hunt for the salt.',
    ],
  },
  {
    slug: 'nigerian-jollof-base',
    category: 'recipes',
    title: 'Getting the base right for Nigerian jollof rice',
    excerpt: 'Jollof lives and dies by its base. A guide to building deep, balanced flavour from the start.',
    readMins: 4,
    body: [
      'Everyone has an opinion on jollof, but almost every great version starts the same way: a well-cooked, well-seasoned pepper base.',
      'Blend tomatoes, red bell peppers (tatashe), scotch bonnet and onion until smooth. The ratio matters — too much tomato turns it sour, so balance it with the sweeter bell peppers and only as much scotch bonnet as your heat tolerance allows.',
      'Fry the base properly. Cook it in oil over medium heat, stirring, until it reduces, darkens and the raw, sharp smell gives way to something rich and sweet. This is where the flavour is built, so do not rush it.',
      'From there, stir in your stock and seasoning, add the rice, and let it cook low and covered so the grains absorb the base evenly. The faint smoky layer at the bottom — the party jollof prize — comes from that patient, low heat.',
    ],
  },
  {
    slug: 'simple-roux-sauces',
    category: 'recipes',
    title: 'A simple roux: the start of great sauces',
    excerpt: 'Master one technique and unlock béchamel, veloutés and countless creamy sauces.',
    readMins: 3,
    body: [
      'A roux is just equal parts fat and flour cooked together, but it is the backbone of some of the most useful sauces in the kitchen.',
      'Melt butter over medium heat, whisk in an equal weight of flour, and cook for a minute or two to lose the raw-flour taste. Cook it longer for a deeper, nuttier colour and flavour.',
      'Then whisk in your liquid gradually — warm milk for a béchamel, stock for a velouté — adding a little at a time to keep it smooth. Simmer until it thickens, season, and you have the base for cheese sauce, gravies, pies and gratins.',
    ],
  },
]

export function getPost(slug) {
  return posts.find((p) => p.slug === slug)
}
