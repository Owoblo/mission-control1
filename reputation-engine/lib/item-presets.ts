import type { InventoryItem } from './types'

export type InventoryPreset = {
  id: string
  label: string
  icon?: string
  room?: string
  item: InventoryItem
}

// Helper to build a preset entry cleanly
function p(
  id: string,
  label: string,
  icon: string,
  room: string,
  cubicFeet: number,
  weightLbs: number,
  notes?: string
): InventoryPreset {
  return {
    id,
    label,
    icon,
    room,
    item: { name: label.split(' · ')[0], qty: 1, cubicFeet, weightLbs, included: true, icon, ...(notes ? { notes } : {}) },
  }
}

export const INVENTORY_PRESETS: InventoryPreset[] = [

  // ── LIVING ROOM ───────────────────────────────────────────────────────────
  p('sofa-loveseat',      'Sofa · Loveseat',           '🛋️', 'Living Room',  40, 80),
  p('sofa-standard',      'Sofa · 3-Seater',           '🛋️', 'Living Room',  55, 110),
  p('sofa-large',         'Sofa · 4-Seater',           '🛋️', 'Living Room',  70, 140),
  p('sofa-bed',           'Sofa Bed',                  '🛋️', 'Living Room',  75, 150,  'Pull-out mechanism — heavier than standard sofa'),
  p('sectional-4seat',    'Sectional · 4-Seater',      '🛋️', 'Living Room', 110, 200),
  p('sectional-large',    'Sectional · 8-Seater',      '🛋️', 'Living Room', 160, 280,  'Disassemble at seam before loading'),
  p('armchair-standard',  'Armchair',                  '🪑', 'Living Room',  20,  40),
  p('club-chair',         'Club Chair',                '🪑', 'Living Room',  25,  70),
  p('overstuffed-chair',  'Overstuffed Chair',         '🪑', 'Living Room',  28,  80),
  p('recliner',           'Recliner Chair',            '🪑', 'Living Room',  30,  85,  'Lay flat for transport'),
  p('papasan-chair',      'Papasan Chair',             '🪑', 'Living Room',  20,  25,  'Remove cushion, pack separately'),
  p('chaise-lounge',      'Chaise Lounge',             '🛋️', 'Living Room',  30,  80),
  p('coffee-table-sm',    'Coffee Table · Small',      '🪵', 'Living Room',  10,  35),
  p('coffee-table-med',   'Coffee Table · Medium',     '🪵', 'Living Room',  15,  45),
  p('coffee-table-lg',    'Coffee Table · Large (5ft+)','🪵','Living Room',  22,  65),
  p('glass-coffee-table', 'Coffee Table · Glass',      '🪞', 'Living Room',  15,  55,  'Glass top — wrap with moving blanket'),
  p('end-table-sm',       'End Table · Small',         '🪵', 'Living Room',   3,  15),
  p('end-table-med',      'End Table · Medium',        '🪵', 'Living Room',   6,  25),
  p('end-table-lg',       'End Table · Large',         '🪵', 'Living Room',  10,  35),
  p('side-table-sm',      'Side Table · Small',        '🪵', 'Living Room',   3,  15),
  p('side-table-med',     'Side Table · Medium',       '🪵', 'Living Room',   6,  25),
  p('nesting-table',      'Nesting Table Set',         '🪵', 'Living Room',   8,  20),
  p('console-table',      'Console Table',             '🪵', 'Living Room',  14,  40),
  p('foyer-table',        'Foyer Table',               '🪵', 'Living Room',  10,  35),
  p('bookcase-sm',        'Bookcase · Small (3×3)',    '📚', 'Living Room',   9,  25),
  p('bookcase-med',       'Bookcase · Medium (4×6)',   '📚', 'Living Room',  24,  50),
  p('bookcase-lg',        'Bookcase · Large (4×8)',    '📚', 'Living Room',  32,  70),
  p('tv-stand-sm',        'TV Stand · Small (3ft)',    '📺', 'Living Room',  15,  40),
  p('tv-stand-med',       'TV Stand · Medium (4ft)',   '📺', 'Living Room',  20,  55),
  p('tv-stand-lg',        'TV Stand · Large (6ft+)',   '📺', 'Living Room',  35,  85),
  p('tv-flat-sm',         'TV · Flat Screen 32–49"',   '📺', 'Living Room',   5,  25,  'TV box or screen protection required'),
  p('tv-flat-med',        'TV · Flat Screen 50–65"',   '📺', 'Living Room',   8,  45,  'TV box or screen protection required'),
  p('tv-flat-lg',         'TV · Flat Screen 66–86"',   '📺', 'Living Room',  12,  75,  'Large TV box and two-person handling recommended'),
  p('tv-console-large',   'Entertainment Center · Large','📺','Living Room', 60, 150,  'Often requires disassembly'),
  p('entertainment-sm',   'Entertainment Center · 4ft','📺', 'Living Room',  35,  90),
  p('entertainment-med',  'Entertainment Center · 5ft','📺', 'Living Room',  45, 120),
  p('display-case',       'Display Case',              '🏆', 'Living Room',  20,  60),
  p('floor-lamp-sm',      'Floor Lamp · Short',        '💡', 'Living Room',   4,  10),
  p('floor-lamp-std',     'Floor Lamp · Standard (7ft)','💡','Living Room',   6,  15),
  p('floor-lamp-tall',    'Floor Lamp · Tall (9ft)',   '💡', 'Living Room',   8,  18),
  p('table-lamp-sm',      'Table Lamp · Small',        '💡', 'Living Room',   1,   5),
  p('table-lamp-med',     'Table Lamp · Medium',       '💡', 'Living Room',   2,   8),
  p('table-lamp-lg',      'Table Lamp · Large',        '💡', 'Living Room',   4,  12),
  p('chandelier-sm',      'Chandelier · Small',        '💡', 'Living Room',   1,  20,  'Wrap arms — very fragile'),
  p('chandelier-med',     'Chandelier · Medium',       '💡', 'Living Room',  10,  35,  'Wrap arms — very fragile'),
  p('chandelier-lg',      'Chandelier · Large',        '💡', 'Living Room',  15,  50,  'Wrap arms — very fragile'),
  p('mirror-sm',          'Mirror · Small (2×3)',      '🪞', 'Living Room',   4,  15,  'Mirror box required'),
  p('mirror-med',         'Mirror · Medium (2.5×5)',   '🪞', 'Living Room',   8,  30,  'Mirror box required'),
  p('mirror-lg',          'Mirror · Large (4×8)',      '🪞', 'Living Room',  10,  50,  'Mirror box required'),
  p('painting-sm',        'Painting/Picture · Small',  '🖼️', 'Living Room',   2,  10,  'Picture box or flat wrap'),
  p('painting-med',       'Painting/Picture · Medium', '🖼️', 'Living Room',   6,  12,  'Picture box or flat wrap'),
  p('painting-lg',        'Painting/Picture · Large',  '🖼️', 'Living Room',  12,  20,  'Custom crating may be needed'),
  p('grandfather-clock',  'Grandfather Clock',         '🕰️', 'Living Room',  28,  90,  'Remove pendulum and weights before moving'),
  p('aquarium-lg',        'Aquarium · Large (50+ gal)','🐠', 'Living Room',  30, 100,  'Drain completely — transport empty only'),
  p('plant-sm',           'Plant · Small (under 4ft)', '🌿', 'Living Room',   3,  15),
  p('plant-med',          'Plant · Medium (6ft)',      '🌿', 'Living Room',  12,  30),
  p('plant-lg',           'Plant · Large (8ft+)',      '🌿', 'Living Room',  25,  60),
  p('upright-piano',      'Piano · Upright',           '🎹', 'Living Room',  55, 450,  'Specialty move — 3 movers minimum, piano board required'),
  p('spinet-piano',       'Piano · Spinet',            '🎹', 'Living Room',  48, 350,  'Specialty move — piano board required'),
  p('console-piano',      'Piano · Console',           '🎹', 'Living Room',  55, 400,  'Specialty move — piano board required'),
  p('baby-grand-piano',   'Piano · Baby Grand',        '🎹', 'Living Room', 100, 650,  'Specialty move — leg removal required, 4 movers min'),
  p('grand-piano',        'Piano · Full Grand',        '🎹', 'Living Room', 150,1000,  'Specialty move — leg removal, 4+ movers, rigging possible'),
  p('piano-bench',        'Piano Bench',               '🎹', 'Living Room',   5,  25),
  p('speaker-sm',         'Speaker · Small',           '🔊', 'Living Room',   3,  15),
  p('speaker-med',        'Speaker · Medium',          '🔊', 'Living Room',   6,  30),
  p('speaker-lg',         'Speaker · Large (2ft+)',    '🔊', 'Living Room',  12,  60),
  p('stereo-component',   'Stereo/AV Component',       '🎛️', 'Living Room',   3,  20),
  p('faux-fireplace',     'Faux Fireplace/Mantle',     '🔥', 'Living Room',  20,  50),

  // ── DINING ROOM ───────────────────────────────────────────────────────────
  p('dining-table-4',     'Dining Table · 4-Seat',     '🍽️', 'Dining Room',  30,  80),
  p('dining-table-6',     'Dining Table · 6-Seat',     '🍽️', 'Dining Room',  45, 110),
  p('dining-table-8',     'Dining Table · 8-Seat',     '🍽️', 'Dining Room',  60, 150),
  p('custom-dining-table','Dining Table · Custom',     '🍽️', 'Dining Room',  50, 130,  'Confirm disassembly with customer'),
  p('glass-dining-4',     'Dining Table · Glass 4-Seat','🪞','Dining Room',  30,  90,  'Glass top — wrap thoroughly'),
  p('glass-dining-6',     'Dining Table · Glass 6-Seat','🪞','Dining Room',  45, 120,  'Glass top — wrap thoroughly'),
  p('glass-dining-8',     'Dining Table · Glass 8-Seat','🪞','Dining Room',  60, 160,  'Glass top — wrap thoroughly'),
  p('dining-chair',       'Dining Chair',              '🪑', 'Dining Room',   5,  15),
  p('kitchen-chair',      'Kitchen Chair',             '🪑', 'Kitchen',       5,  15),
  p('bar-stool',          'Bar Stool',                 '🪑', 'Dining Room',   4,  15),
  p('china-cabinet-sm',   'China Cabinet · Small',     '🏺', 'Dining Room',  35, 140,  'Glass doors — wrap carefully, remove shelves'),
  p('china-cabinet-med',  'China Cabinet · Medium',    '🏺', 'Dining Room',  45, 160,  'Glass doors — wrap carefully, remove shelves'),
  p('china-cabinet-lg',   'China Cabinet · Large (4×8)','🏺','Dining Room',  50, 185,  'Glass doors — wrap carefully, remove shelves'),
  p('buffet',             'Buffet / Sideboard',        '🪵', 'Dining Room',  45, 130),
  p('credenza-5ft',       'Credenza · 5ft',            '🪵', 'Dining Room',  35, 120),
  p('credenza-7ft',       'Credenza · 7ft',            '🪵', 'Dining Room',  50, 150),
  p('credenza-9ft',       'Credenza · 9ft',            '🪵', 'Dining Room',  65, 200),
  p('card-table',         'Card/Folding Table',        '🃏', 'Dining Room',   6,  15),
  p('folding-table',      'Folding Table',             '🪵', 'Other',         8,  25),
  p('folding-chair',      'Folding Chair',             '🪑', 'Other',         2,  10),

  // ── KITCHEN ───────────────────────────────────────────────────────────────
  p('kitchen-table',      'Kitchen Table',             '🍽️', 'Kitchen',      25,  65),
  p('kitchen-cabinet',    'Kitchen Cabinet · Freestanding','🪵','Kitchen',   15,  50),
  p('microwave',          'Microwave',                 '📡', 'Kitchen',       3,  30),
  p('microwave-cart',     'Microwave Cart',            '🪵', 'Kitchen',       8,  25),
  p('coffee-maker',       'Coffee Maker',              '☕', 'Kitchen',       1,   5),
  p('toaster-oven',       'Toaster Oven',              '🍞', 'Kitchen',       1,   8),
  p('blender',            'Blender',                   '🥤', 'Kitchen',       1,   5),
  p('food-processor',     'Food Processor',            '🥣', 'Kitchen',       1,   8),
  p('juicer',             'Juicer',                    '🍊', 'Kitchen',       1,   8),
  p('bread-maker',        'Bread Maker',               '🍞', 'Kitchen',       1,   8),
  p('crock-pot',          'Crock Pot / Instant Pot',   '🍲', 'Kitchen',       1,   8),
  p('butcher-block',      'Butcher Block Island',      '🪵', 'Kitchen',      20, 100,  'Heavy — may require dolly'),
  p('wine-rack',          'Wine Rack',                 '🍷', 'Kitchen',       8,  20,  'Remove all bottles before moving'),
  p('high-chair',         'High Chair',                '👶', 'Kitchen',       6,  15),
  p('dish-box',           'Dish Pack Box',             '📦', 'Kitchen',       5,  40,  'Packed dishes — heavy, handle with care'),

  // ── APPLIANCES (major — customer opt-in) ──────────────────────────────────
  p('fridge-mini',        'Refrigerator · Mini',       '🧊', 'Kitchen',       8,  40),
  p('fridge-wine',        'Refrigerator · Wine',       '🍷', 'Kitchen',      12,  60),
  p('fridge-under5ft',    'Refrigerator · Compact',    '🧊', 'Kitchen',      30, 180),
  p('fridge-standard',    'Refrigerator · Standard',   '🧊', 'Kitchen',      45, 250,  'Confirm taking fridge — door removal may be needed'),
  p('fridge-large',       'Refrigerator · French Door','🧊', 'Kitchen',      60, 320,  'Large fridge — door removal likely required'),
  p('fridge-xl',          'Refrigerator · Extra Wide', '🧊', 'Kitchen',      75, 380,  'Wider than 5ft — confirm door clearance'),
  p('chest-freezer',      'Freezer · Chest',           '🧊', 'Basement',     35, 180,  'Defrost completely before move'),
  p('freezer-standalone', 'Freezer · Upright',         '🧊', 'Basement',     35, 180,  'Defrost completely before move'),
  p('stove-freestanding', 'Stove · Freestanding',      '🔥', 'Kitchen',      30, 150,  'Disconnect gas/electric before move'),
  p('oven',               'Oven / Range',              '🔥', 'Kitchen',      30, 150,  'Disconnect gas/electric before move'),
  p('dishwasher',         'Dishwasher · Freestanding', '🍽️', 'Kitchen',      22,  80,  'Freestanding only — not built-in'),
  p('washer-freestanding','Washer · Freestanding',     '🫧', 'Basement',     28, 180,  'Disconnect hoses, secure drum before move'),
  p('dryer-freestanding', 'Dryer · Freestanding',      '💨', 'Basement',     28, 135,  'Disconnect vent and power'),
  p('washer-dryer-combo', 'Washer/Dryer Combo Unit',   '🫧', 'Basement',     30, 180,  'Disconnect hoses and vent before move'),
  p('water-cooler',       'Water Cooler / Dispenser',  '💧', 'Kitchen',       6,  25),

  // ── BEDROOM ───────────────────────────────────────────────────────────────
  p('single-bed',         'Bed Frame · Single',        '🛏️', 'Bedroom',      18,  50,  'Disassembly required'),
  p('twin-bed',           'Bed Frame · Twin',          '🛏️', 'Bedroom',      20,  55,  'Disassembly required'),
  p('full-bed',           'Bed Frame · Full',          '🛏️', 'Bedroom',      28,  80,  'Disassembly required'),
  p('queen-bed',          'Bed Frame · Queen',         '🛏️', 'Bedroom',      35, 100,  'Disassembly required'),
  p('king-bed',           'Bed Frame · King',          '🛏️', 'Bedroom',      45, 130,  'Disassembly required'),
  p('grand-king-bed',     'Bed Frame · Grand King',    '🛏️', 'Bedroom',      55, 155,  'Disassembly required'),
  p('captain-bed',        'Captain\'s Bed',            '🛏️', 'Bedroom',      55, 140,  'Disassembly required — has under-bed storage'),
  p('bunk-bed',           'Bunk Bed',                  '🛏️', 'Bedroom',      75, 180,  'Full disassembly required'),
  p('children-bed',       'Children\'s Bed',           '🛏️', 'Bedroom',      30,  60,  'Disassembly required'),
  p('toddler-bed',        'Toddler Bed',               '🛏️', 'Bedroom',      18,  35,  'Disassembly required'),
  p('daybed',             'Daybed',                    '🛏️', 'Bedroom',      50, 100,  'Disassembly required'),
  p('murphy-bed',         'Murphy Bed / Wall Bed',     '🛏️', 'Bedroom',      60, 200,  'Specialty item — confirm disassembly from wall'),
  p('trundle',            'Trundle Bed',               '🛏️', 'Bedroom',      22,  55),
  p('mattress-single',    'Mattress · Single/Twin',    '🛏️', 'Bedroom',      18,  50),
  p('mattress-full',      'Mattress · Full',           '🛏️', 'Bedroom',      25,  75),
  p('mattress-queen',     'Mattress · Queen',          '🛏️', 'Bedroom',      35, 100),
  p('mattress-king',      'Mattress · King',           '🛏️', 'Bedroom',      45, 130),
  p('mattress-grandking', 'Mattress · Grand King',     '🛏️', 'Bedroom',      55, 150),
  p('wood-bed-frame',     'Bed Frame · Wood',          '🛏️', 'Bedroom',      20,  40,  'Disassembly required'),
  p('metal-bed-frame',    'Bed Frame · Metal Collapsible','🛏️','Bedroom',    10,  20,  'Folds flat — easy to move'),
  p('headboard',          'Headboard',                 '🛏️', 'Bedroom',      15,  30),
  p('footboard',          'Footboard',                 '🛏️', 'Bedroom',      12,  25),
  p('dresser-sm',         'Dresser · Small (2×4)',     '🗄️', 'Bedroom',      25,  90),
  p('dresser-med',        'Dresser · Medium (3×5)',    '🗄️', 'Bedroom',      40, 120),
  p('dresser-lg',         'Dresser · Large (5×5)',     '🗄️', 'Bedroom',      55, 160),
  p('lingerie-chest',     'Lingerie Chest / Tall Narrow','🗄️','Bedroom',     18,  70),
  p('wardrobe-closet',    'Wardrobe Closet',           '👔', 'Bedroom',      50, 150,  'Disassembly likely required'),
  p('armoire-sm',         'Armoire · Small (4×7)',     '👔', 'Bedroom',      40, 160,  'Remove doors for transport'),
  p('armoire-lg',         'Armoire · Large (4×8)',     '👔', 'Bedroom',      48, 200,  'Remove doors for transport'),
  p('nightstand',         'Nightstand',                '🪵', 'Bedroom',       6,  18),
  p('vanity',             'Vanity Table',              '🪞', 'Bedroom',      18,  60),
  p('bench',              'Bench (Bedroom/Foyer)',     '🪑', 'Bedroom',      10,  25),
  p('changing-table',     'Changing Table',            '👶', 'Bedroom',      15,  40),
  p('bassinet',           'Bassinet',                  '👶', 'Bedroom',       8,  20),
  p('crib',               'Crib',                     '👶', 'Bedroom',      28,  65,  'Disassembly required'),
  p('crib-mattress',      'Crib Mattress',             '👶', 'Bedroom',       8,  15),
  p('car-seat',           'Car Seat',                  '👶', 'Bedroom',       6,  15),
  p('baby-monitor',       'Baby Monitor/Equipment',    '👶', 'Bedroom',       1,   3),
  p('stroller',           'Stroller',                  '👶', 'Other',         8,  20),
  p('playpen',            'Playpen',                   '👶', 'Bedroom',      10,  20,  'Folds flat'),
  p('wardrobe-box',       'Wardrobe Box (hanging clothes)','📦','Bedroom',   13,  35,  'Hanging clothes avg 35 lbs — confirm qty'),
  p('shoe-rack',          'Shoe Rack',                 '👟', 'Bedroom',       4,  10),
  p('clothing-rack',      'Clothing Rack',             '👔', 'Bedroom',       5,  10),
  p('hamper',             'Hamper / Laundry Basket',   '🧺', 'Bedroom',       4,   5),

  // ── OFFICE ───────────────────────────────────────────────────────────────
  p('desk-sm',            'Desk · Small (4×2.5)',      '💻', 'Office',       18,  45),
  p('desk-standard',      'Desk · Standard (6×2.5)',   '💻', 'Office',       25,  65),
  p('desk-lg',            'Desk · Large (8×3)',        '💻', 'Office',       35,  90),
  p('desk-return',        'Desk · With Return',        '💻', 'Office',       45, 120,  'L-shape — disassembly usually required'),
  p('desk-hutch',         'Desk · With Hutch',         '💻', 'Office',       55, 140,  'Remove hutch for transport'),
  p('glass-desk-sm',      'Desk · Glass Small',        '🪞', 'Office',       18,  50,  'Glass top — wrap carefully'),
  p('glass-desk-lg',      'Desk · Glass Large',        '🪞', 'Office',       35, 100,  'Glass top — wrap carefully'),
  p('drafting-table',     'Drafting Table',            '✏️', 'Office',       20,  55),
  p('work-table-sm',      'Work Table · Small (4×2.5)','🪵', 'Office',       18,  55),
  p('work-table-lg',      'Work Table · Large (6×3)',  '🪵', 'Office',       30,  80),
  p('office-chair',       'Office Chair',              '🪑', 'Office',       10,  22),
  p('executive-chair',    'Executive Chair',           '🪑', 'Office',       12,  35),
  p('conference-chair',   'Conference Chair',          '🪑', 'Office',        6,  18),
  p('conf-table-6ft',     'Conference Table · 6ft',    '🪵', 'Office',       30, 120),
  p('conf-table-8ft',     'Conference Table · 8ft',    '🪵', 'Office',       45, 180),
  p('conf-table-10ft',    'Conference Table · 10ft',   '🪵', 'Office',       55, 220),
  p('conf-table-12ft',    'Conference Table · 12ft',   '🪵', 'Office',       65, 260),
  p('bookshelf-sm',       'Bookcase · Small (3×3)',    '📚', 'Office',        9,  25),
  p('bookshelf-med',      'Bookcase · Medium (4×6)',   '📚', 'Office',       24,  50),
  p('bookshelf-lg',       'Bookcase · Large (4×8)',    '📚', 'Office',       32,  70),
  p('file-cab-2v',        'File Cabinet · 2-Drawer Vertical','🗂️','Office',   8,  40),
  p('file-cab-4v',        'File Cabinet · 4-Drawer Vertical','🗂️','Office',  15,  65),
  p('file-cab-2l',        'File Cabinet · 2-Drawer Lateral', '🗂️','Office',  12,  55),
  p('file-cab-4l',        'File Cabinet · 4-Drawer Lateral', '🗂️','Office',  20,  85),
  p('printer-sm',         'Printer · Small',           '🖨️', 'Office',        2,  10),
  p('printer-med',        'Printer · Medium',          '🖨️', 'Office',        4,  25),
  p('printer-lg',         'Printer · Large/Commercial','🖨️', 'Office',        8,  40),
  p('printer-stand',      'Printer Stand',             '🪵', 'Office',        6,  20),
  p('scanner',            'Scanner',                   '🖨️', 'Office',        2,  15),
  p('fax-machine',        'Fax Machine',               '📠', 'Office',        2,  15),
  p('computer-desktop-sm','Computer Desktop · Small',  '🖥️', 'Office',        1,   8),
  p('computer-desktop-lg','Computer Desktop · Large Tower','🖥️','Office',     3,  25),
  p('monitor-sm',         'Monitor · Small (up to 27")', '🖥️','Office',       2,  10),
  p('monitor-lg',         'Monitor · Large (28"+)',    '🖥️', 'Office',        4,  18),
  p('cubicle',            'Cubicle / Office Partition','🏢', 'Office',       30,  80,  'Disassembly required'),
  p('locker-metal',       'Metal Locker',              '🔒', 'Office',       10,  45),
  p('paper-shredder',     'Paper Shredder',            '🗑️', 'Office',        3,  25),
  p('laminator',          'Laminating Machine',        '🖨️', 'Office',        2,  12),
  p('cubby-3ft',          'Cubby/Shelving · 3ft',      '📚', 'Office',        9,  30),
  p('cubby-9ft',          'Cubby/Shelving · 9ft',      '📚', 'Office',       27,  80),
  p('cubby-12ft',         'Cubby/Shelving · 12ft',     '📚', 'Office',       36, 110),
  p('drawer-unit',        'Drawer Unit / Pedestal',    '🗄️', 'Office',       12,  40),

  // ── BEDROOM / KIDS ───────────────────────────────────────────────────────
  p('children-table',     'Children\'s Table',         '🧒', 'Kids Room',     5,  15),
  p('children-chair',     'Children\'s Chair',         '🧒', 'Kids Room',     3,  10),
  p('children-bicycle',   'Children\'s Bicycle',       '🚲', 'Kids Room',     8,  15),
  p('toy-chest',          'Toy Chest / Bin',           '🧸', 'Kids Room',    14,  35),
  p('toy-car',            'Kids Ride-On Toy',          '🚗', 'Kids Room',     8,  15),
  p('toy-trunk',          'Toy Trunk',                 '🧸', 'Kids Room',    10,  25),
  p('dollhouse',          'Dollhouse',                 '🏠', 'Kids Room',    10,  20),
  p('bassinet-bouncer',   'Baby Bouncer/Swing',        '👶', 'Kids Room',     5,   8),

  // ── BATHROOM ─────────────────────────────────────────────────────────────
  p('bathroom-cabinet',   'Bathroom Cabinet',          '🚿', 'Bathroom',      8,  30),

  // ── GARAGE & WORKSHOP ────────────────────────────────────────────────────
  p('tool-chest-sm',      'Tool Chest · Small',        '🔧', 'Garage',        8,  60),
  p('tool-chest-med',     'Tool Chest · Medium',       '🔧', 'Garage',       18, 120,  'Empty drawers before move'),
  p('tool-chest-lg',      'Tool Chest · Large',        '🔧', 'Garage',       30, 200,  'Empty drawers before move'),
  p('tool-box',           'Tool Box / Portable',       '🔧', 'Garage',        5,  30),
  p('workbench',          'Workbench',                 '🔧', 'Garage',       40, 120),
  p('garage-shelving',    'Garage Shelving Unit',      '🔧', 'Garage',       30,  55,  'Disassembly required'),
  p('storage-cabinet-metal','Metal Storage Cabinet',  '🗄️', 'Garage',       25,  90),
  p('lawn-mower-push',    'Lawn Mower · Push',         '🌿', 'Garage',       15,  65,  'Drain fuel before loading'),
  p('lawn-mower-riding',  'Lawn Mower · Riding',       '🚜', 'Garage',       55, 400,  'Specialty — drain fuel, ramp required'),
  p('snow-blower',        'Snow Blower',               '❄️', 'Garage',       20, 110,  'Drain gas before move'),
  p('wheelbarrow',        'Wheelbarrow',               '⛏️', 'Garage',       10,  35),
  p('ladder-sm',          'Ladder · Small',            '🪜', 'Garage',        5,  10),
  p('ladder-med',         'Ladder · Medium',           '🪜', 'Garage',        8,  15),
  p('ladder-lg',          'Ladder · Large',            '🪜', 'Garage',       12,  25),
  p('hoe',                'Hoe / Garden Tools',        '🌿', 'Garage',        2,   5),
  p('rake',               'Rake',                      '🍂', 'Garage',        2,   5),
  p('shovel',             'Shovel',                    '⛏️', 'Garage',        2,   8),
  p('broom',              'Broom / Mop',               '🧹', 'Other',         1,   2),
  p('vacuum',             'Vacuum Cleaner',            '🧹', 'Other',         5,  15),
  p('iron',               'Iron',                      '👔', 'Other',         1,   4),
  p('ironing-board',      'Ironing Board',             '👔', 'Other',         4,   8),
  p('fan-table',          'Fan · Table',               '💨', 'Other',         2,   5),
  p('fan-standing',       'Fan · Standing',            '💨', 'Other',         4,  10),
  p('space-heater',       'Space Heater',              '🔥', 'Other',         2,  10),

  // ── OUTDOOR ───────────────────────────────────────────────────────────────
  p('patio-set',          'Patio Dining Set',          '🌞', 'Outdoor',      55,  95),
  p('outdoor-sofa-2seat', 'Outdoor Sofa · Loveseat',   '🛋️', 'Outdoor',      30,  60),
  p('outdoor-sofa-3seat', 'Outdoor Sofa · 3-Seater',   '🛋️', 'Outdoor',      45,  85),
  p('outdoor-chair',      'Outdoor Chair',             '🪑', 'Outdoor',      10,  18),
  p('outdoor-lounge',     'Outdoor Lounge Chair',      '🌞', 'Outdoor',      20,  30),
  p('outdoor-table-4',    'Outdoor Table · 4-Seat',    '🌞', 'Outdoor',      20,  45),
  p('outdoor-table-6',    'Outdoor Table · 6-Seat',    '🌞', 'Outdoor',      30,  65),
  p('outdoor-table-8',    'Outdoor Table · 8-Seat',    '🌞', 'Outdoor',      45,  90),
  p('outdoor-end-table',  'Outdoor End Table',         '🌞', 'Outdoor',       5,  12),
  p('patio-umbrella',     'Patio Umbrella',            '☂️', 'Outdoor',      12,  25),
  p('barbecue-sm',        'Barbecue · Small (2.5ft)',  '🔥', 'Outdoor',      15,  50,  'Disconnect propane — cannot transport filled tank'),
  p('barbecue',           'Barbecue · Medium (3.5ft)', '🔥', 'Outdoor',      22,  70,  'Disconnect propane — cannot transport filled tank'),
  p('barbecue-lg',        'Barbecue · Large (5ft)',    '🔥', 'Outdoor',      35, 100,  'Disconnect propane — cannot transport filled tank'),
  p('fire-pit',           'Fire Pit',                  '🔥', 'Outdoor',      15,  60),
  p('outdoor-storage',    'Outdoor Storage Box',       '📦', 'Outdoor',      20,  45),
  p('bicycle',            'Bicycle',                   '🚲', 'Outdoor',      12,  25,  'Remove pedals, lower seat for packing'),
  p('bike-rack',          'Bike Rack',                 '🚲', 'Outdoor',       5,  10),
  p('golf-bag',           'Golf Bag',                  '⛳', 'Outdoor',       8,  30),
  p('skis',               'Skis / Snowboard',          '⛷️', 'Outdoor',       6,  10),
  p('surfboard',          'Surfboard',                 '🏄', 'Outdoor',       8,  10,  'Wrap with moving blanket'),
  p('trampoline',         'Trampoline',                '⭕', 'Outdoor',      50, 120,  'Disassemble frame before move'),
  p('playground-set',     'Playground Set',            '🛝', 'Outdoor',      80, 200,  'Full disassembly required'),
  p('swing-set',          'Swing Set',                 '🛝', 'Outdoor',      60, 150,  'Disassembly required'),
  p('hot-tub',            'Hot Tub',                   '🛁', 'Outdoor',     120, 750,  'Specialty — drain first, 4 movers min, rigging may be needed'),
  p('shed-sm',            'Shed · Small',              '🏠', 'Outdoor',     100, 300,  'Confirm disassembly or specialty rigging'),
  p('garden-pots',        'Garden Pots · Large (5)',   '🌿', 'Outdoor',      20, 150,  'Qty of 5 pots'),
  p('bbq-lg',             'BBQ / Grill · Large',       '🔥', 'Outdoor',      45, 120,  'Disconnect propane — cannot transport filled tank'),
  p('kids-playhouse',     'Kids Playhouse',            '🏠', 'Outdoor',      90, 180,  'Full disassembly required'),
  p('patio-umbrella-base','Patio Umbrella + Base',     '☂️', 'Outdoor',      12,  60),

  // ── FITNESS & RECREATION ─────────────────────────────────────────────────
  p('treadmill',          'Treadmill',                 '🏃', 'Basement',     45, 220,  'Fold if possible, heavy base'),
  p('elliptical',         'Elliptical',                '🏋️', 'Basement',     35, 180),
  p('exercise-bike',      'Exercise Bike / Spin Bike', '🚴', 'Basement',     18,  70),
  p('weight-bench',       'Weight Bench',              '🏋️', 'Basement',     18,  80),
  p('dumbbells-light',    'Dumbbells · Light (up to 10lb pair)','🏋️','Basement',1, 10),
  p('dumbbells-med',      'Dumbbells · Medium (11–30lb pair)','🏋️','Basement', 2, 25),
  p('dumbbells-heavy',    'Dumbbells · Heavy (31lb+ pair)','🏋️','Basement',    3, 50),
  p('ping-pong',          'Ping Pong Table',           '🏓', 'Basement',     55, 150,  'Folds in half — still very heavy'),
  p('pool-table',         'Pool Table',                '🎱', 'Basement',     70, 700,  'Specialty — slate removal required, 4 movers minimum'),
  p('foosball-table',     'Foosball / Air Hockey Table','🎮','Basement',     30, 100),
  p('pinball-machine',    'Pinball Machine',           '🎮', 'Basement',     25, 250,  'Very heavy — dolly required'),

  // ── INSTRUMENTS ───────────────────────────────────────────────────────────
  p('guitar',             'Guitar',                    '🎸', 'Other',         5,  10,  'Hard case preferred'),
  p('guitar-amp',         'Guitar Amplifier',          '🎸', 'Other',         8,  40),
  p('drums',              'Drum Kit',                  '🥁', 'Other',        20,  80,  'Disassemble hardware'),
  p('violin',             'Violin',                    '🎻', 'Other',         2,   5),
  p('trumpet',            'Trumpet / Horn',            '🎺', 'Other',         2,   5),
  p('trombone',           'Trombone',                  '🎺', 'Other',         4,   8),
  p('saxophone',          'Saxophone',                 '🎷', 'Other',         4,  10),
  p('clarinet',           'Clarinet',                  '🎵', 'Other',         1,   5),

  // ── ARTWORK & DÉCOR ───────────────────────────────────────────────────────
  p('sculpture-sm',       'Sculpture · Small',         '🏺', 'Other',         3,  10),
  p('sculpture-med',      'Sculpture · Medium',        '🏺', 'Other',         8,  25),
  p('sculpture-lg',       'Sculpture · Large',         '🏺', 'Other',        15,  60),
  p('mannequin',          'Mannequin',                 '🧍', 'Other',         6,  12),

  // ── STORAGE BOXES ─────────────────────────────────────────────────────────
  p('box-small',          'Box · Small (1.5 cu ft)',   '📦', 'Boxes',         1.5, 15, 'Books, dishes, heavy items'),
  p('box-medium',         'Box · Medium (3.0 cu ft)',  '📦', 'Boxes',         3,   25, 'Clothes, kitchen, general'),
  p('box-large',          'Box · Large (4.5 cu ft)',   '📦', 'Boxes',         4.5, 30, 'Pillows, linens, light bulky'),
  p('box-xl',             'Box · XL (6 cu ft)',        '📦', 'Boxes',         6,   25, 'Oversized lightweight items'),
  p('tv-box-32',          'TV Box · 32–54"',           '📺', 'Boxes',         9,   12, 'TV moving box — wrap included'),
  p('tv-box-55',          'TV Box · 55–65"',           '📺', 'Boxes',        12,   15, 'TV moving box — wrap included'),
  p('tv-box-70',          'TV Box · 70–86"',           '📺', 'Boxes',        16,   20, 'Large TV box — wrap included'),
  p('mirror-box',         'Mirror / Picture Box',      '🪞', 'Boxes',         5,   10, 'Flat art, mirrors, framed items'),
  p('wardrobe-box-hng',   'Wardrobe Box (hanging)',    '📦', 'Boxes',        13,   35, 'Hanging clothes — avg 35 lbs packed'),
  p('dish-pack-box',      'Dish Pack Box',             '📦', 'Boxes',         5,   40, 'Fragile — heavy when packed'),
  p('plastic-bin-sm',     'Plastic Bin · Small',       '📦', 'Boxes',         2,   8),
  p('plastic-bin-med',    'Plastic Bin · Medium',      '📦', 'Boxes',         5,  15),
  p('plastic-bin-lg',     'Plastic Bin · Large',       '📦', 'Boxes',         8,  20),
  p('milk-crate',         'Milk Crate',                '📦', 'Boxes',         2,   5),
  p('duffle-bag',         'Duffel Bag',                '👜', 'Other',         3,  20),
  p('suitcase',           'Suitcase',                  '🧳', 'Other',         4,  20),
  p('rental-bin-sm',      'Rental Bin · Small',        '📦', 'Boxes',         2,  10),
  p('rental-bin-lg',      'Rental Bin · Large',        '📦', 'Boxes',         4,  15),

  // ── SPECIALTY / HIGH-VALUE ────────────────────────────────────────────────
  p('gun-safe',           'Safe · Gun Safe',           '🔒', 'Basement',     18, 350,  'Very heavy — dolly mandatory'),
  p('safe-standard',      'Safe · Standard',           '🔒', 'Basement',     10, 200,  'Heavy — verify weight before lifting'),
  p('safe-large',         'Safe · Large',              '🔒', 'Basement',     18, 500,  'Specialty item — dolly mandatory'),
  p('ac-unit',            'Air Conditioner · Window',  '❄️', 'Other',         7,  50,  'Drain condensate before moving'),
  p('chandelier-crystal', 'Chandelier · Crystal/Heavy','💡', 'Other',        15,  50,  'Very fragile — custom crating recommended'),
  p('grandfather-clk',    'Grandfather Clock',         '🕰️', 'Other',        28,  90,  'Remove pendulum and weights before moving'),
  p('rug-sm',             'Rug · Small (4ft rolled)',  '🪨', 'Other',         4,  15),
  p('rug-med',            'Rug · Medium (7ft rolled)', '🪨', 'Other',         8,  35),
  p('rug-lg',             'Rug · Large (9ft rolled)',  '🪨', 'Other',        12,  50),
  p('rug-runner',         'Rug · Runner',              '🪨', 'Other',         4,  15),
  p('easel-sm',           'Easel · Small',             '🎨', 'Other',         3,   8),
  p('easel-med',          'Easel · Medium',            '🎨', 'Other',         5,  15),
  p('easel-lg',           'Easel · Large',             '🎨', 'Other',         8,  20),

  // ── JUNK / DISPOSAL ───────────────────────────────────────────────────────
  p('junk-item-sm',       'Junk Removal · Small Item', '🗑️', 'Other',         5,  20,  'Disposal fee may apply'),
  p('junk-item-lg',       'Junk Removal · Large Item', '🗑️', 'Other',        20,  60,  'Disposal fee applies — confirm with customer'),
  p('commercial-bin',     'Commercial Bin / Dumpster', '🗑️', 'Other',       100, 400,  'Specialty — confirm equipment needed'),
]

export function createInventoryItemFromPreset(preset: InventoryPreset): InventoryItem {
  return {
    id: `inv-${preset.id}-${Date.now()}`,
    room: preset.room || 'Unassigned',
    icon: preset.icon,
    ...preset.item,
  }
}

export function matchInventoryPreset(name?: string) {
  if (!name) return null
  const normalize = (value: string) => value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:la\s*z\s*boy|lazyboy|lazy boy)\s+(?:couch|chair|recliner)?\b/g, 'recliner chair')
    .replace(/\bchest(?:s)?\s+of\s+drawers\b/g, 'dresser')
    .replace(/\bsingle\s+bed\b/g, 'bed frame single')
    .replace(/\bend tables\b/g, 'end table')
    .replace(/\bside tables\b/g, 'side table')
    .replace(/\bnight stands\b/g, 'nightstand')
    .replace(/\bchairs\b/g, 'chair')
    .replace(/\btelevisions?\b/g, 'tv')
    .trim()
  const normalized = normalize(name)
  if (!normalized) return null

  const tvSize = normalized.match(/\b(\d{2,3})\s*(?:inch|inches|in)?\s*(?:plasma\s+)?tv\b/)
  if (tvSize && !/\b(?:stand|box|console|center)\b/.test(normalized)) {
    const inches = Number(tvSize[1])
    const id = inches < 50 ? 'tv-flat-sm' : inches <= 65 ? 'tv-flat-med' : 'tv-flat-lg'
    return INVENTORY_PRESETS.find(preset => preset.id === id) || null
  }
  if (/^(?:plasma |flat screen |smart )?tv$/.test(normalized)) {
    return INVENTORY_PRESETS.find(preset => preset.id === 'tv-flat-med') || null
  }
  if (normalized === 'chair') {
    return INVENTORY_PRESETS.find(preset => preset.id === 'dining-chair') || null
  }

  // These are accessories, not pianos. A broad substring match on "piano"
  // previously assigned a collapsible keyboard stand 55 cu ft / 450 lb.
  if (/\b(?:piano|keyboard)\s+(?:stand|rack)\b/.test(normalized)) return null

  const candidates = INVENTORY_PRESETS
    .map(preset => {
      const itemName = normalize((preset.item.name || '').split(' ·')[0])
      const label = normalize(preset.label.split(' ·')[0])
      const aliases = Array.from(new Set([itemName, label].filter(Boolean)))
      const exact = aliases.some(alias => normalized === alias)
      const contained = aliases
        .filter(alias => alias.length >= 4)
        .filter(alias => new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(normalized))
        .sort((a, b) => b.length - a.length)[0]
      return { preset, exact, matchedLength: contained?.length || 0 }
    })
    .filter(candidate => candidate.exact || candidate.matchedLength > 0)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.matchedLength - a.matchedLength)

  return candidates[0]?.preset || null
}
