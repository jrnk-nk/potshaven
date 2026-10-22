export function seedData(now = new Date()) {
  function day(offset) { const date = new Date(now); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
  const image = id => `/images/place-${id}.svg`;
  const plants = {
    monstera: '/images/plant-monstera.svg', palm: '/images/plant-palm.svg', snake: '/images/plant-snake.svg', peace: '/images/plant-peace-lily.svg', ficus: '/images/plant-ficus.svg', croton: '/images/plant-croton.svg', fern: '/images/plant-fern.svg', aloe: '/images/plant-aloe.svg',
  };
  return {
    settings: { companyName: 'PotsHavenGh', tagline: 'Brighten your world', email: '', phone: '', currency: 'GHS', logo: '/branding/potshaven-logo.png', watermark: 'PotsHavenGh', address: '' },
    places: [
      { id: 'place-1', name: 'The Palm Residence', client: 'Mrs. Adjei', address: '12 Palm Crescent, East Legon, Accra', phone: '+233245550101', type: 'Residence', image: image('1'), measurements: 'Front garden: 18m × 8m; terrace: 6m × 4m', notes: 'Use the side entrance. Water access beside the garage.' },
      { id: 'place-2', name: 'Labadi Beach Hotel', client: 'Ama Mensah', address: 'La Road, Labadi, Accra', phone: '+233245550102', type: 'Hotel', image: image('2'), measurements: 'Entrance beds: 30m × 3m; courtyard: 12m × 12m', notes: 'Arrive before 9am. Reception will open the service gate.' },
      { id: 'place-3', name: 'Airport City Roundabout', client: 'Airport City Management', address: 'Liberation Road, Airport City, Accra', phone: '+233245550103', type: 'Roundabout', image: image('3'), measurements: 'Central island: 16m diameter', notes: 'High visibility vests required. Bring cones for the work area.' },
      { id: 'place-4', name: 'Cantonments Villa', client: 'Mr. & Mrs. Boateng', address: '5 Fourth Circular Road, Cantonments, Accra', phone: '+233245550104', type: 'Residence', image: image('1'), measurements: 'Rear garden: 22m × 15m', notes: 'Client prefers flowering plants and a low-maintenance garden.' },
      { id: 'place-5', name: 'Osu Avenue Median', client: 'City Landscaping Office', address: 'Oxford Street, Osu, Accra', phone: '+233245550105', type: 'Median', image: image('3'), measurements: 'Median: 120m × 2m', notes: 'Work in sections. Take completion pictures from both ends.' },
      { id: 'place-6', name: 'The Green Courtyard', client: 'Nana Osei', address: 'Spintex Road, Accra', phone: '+233245550106', type: 'Commercial', image: image('2'), measurements: 'Courtyard: 14m × 10m', notes: 'Weekly maintenance on Tuesday mornings.' },
    ],
    workers: [
      { id: 'worker-1', name: 'Kwame Asante', role: 'Crew leader', skills: ['Pruning', 'Irrigation', 'Driving'], phone: '+233245550201', available: true },
      { id: 'worker-2', name: 'Akosua Owusu', role: 'Gardener', skills: ['Planting', 'Plant care'], phone: '+233245550202', available: true },
      { id: 'worker-3', name: 'Kofi Mensah', role: 'Gardener', skills: ['Mowing', 'Pruning'], phone: '+233245550203', available: true },
      { id: 'worker-4', name: 'Esi Ampofo', role: 'Decorator', skills: ['Decorating', 'Planting'], phone: '+233245550204', available: true },
      { id: 'worker-5', name: 'Yaw Ofori', role: 'Driver', skills: ['Driving', 'Equipment care'], phone: '+233245550205', available: true },
      { id: 'worker-6', name: 'Abena Darko', role: 'Gardener', skills: ['Plant care', 'Fertilising'], phone: '+233245550206', available: false },
    ],
    vehicles: [
      { id: 'vehicle-1', name: 'Toyota Hilux', registration: 'GR 2481-23', capacity: '5 people · tools & plants', status: 'Available' },
      { id: 'vehicle-2', name: 'Hyundai Porter', registration: 'GT 6732-22', capacity: '3 people · large materials', status: 'Available' },
      { id: 'vehicle-3', name: 'Nissan Pickup', registration: 'GW 1205-24', capacity: '5 people · garden equipment', status: 'Available' },
    ],
    jobs: [
      { id: 'job-1', title: 'Garden refresh & weekly care', placeId: 'place-1', date: day(0), time: '08:00', status: 'Scheduled', type: 'Maintenance', crewIds: ['worker-1', 'worker-2'], vehicleId: 'vehicle-1', tasks: [{ text: 'Prune hedges and remove dry leaves', done: false }, { text: 'Water all beds and check irrigation', done: false }, { text: 'Photograph completed work', done: false }], deadline: day(0), budget: 1800, notes: 'Bring pruning shears, gloves, fertiliser and 4 peace lilies.', photos: [] },
      { id: 'job-2', title: 'Entrance planting & pot arrangement', placeId: 'place-2', date: day(0), time: '09:30', status: 'In progress', type: 'Project', crewIds: ['worker-4', 'worker-5'], vehicleId: 'vehicle-2', tasks: [{ text: 'Prepare entrance planting beds', done: true }, { text: 'Arrange decorative pots', done: false }, { text: 'Final walkthrough with client', done: false }], deadline: day(3), budget: 12000, notes: 'Entrance layout approved by hotel manager.', photos: [] },
      { id: 'job-3', title: 'Lawn trim & flower bed maintenance', placeId: 'place-3', date: day(0), time: '11:00', status: 'Scheduled', type: 'Maintenance', crewIds: ['worker-1', 'worker-3'], vehicleId: 'vehicle-1', tasks: [{ text: 'Trim grass and clear litter', done: false }, { text: 'Check flower beds', done: false }], deadline: day(0), budget: 2200, notes: 'Bring safety cones and high visibility vests.', photos: [] },
      { id: 'job-4', title: 'Courtyard planting installation', placeId: 'place-4', date: day(1), time: '08:30', status: 'Scheduled', type: 'Project', crewIds: ['worker-2', 'worker-4'], vehicleId: 'vehicle-2', tasks: [{ text: 'Prepare soil and lay out plants', done: false }, { text: 'Plant and mulch beds', done: false }], deadline: day(5), budget: 8500, notes: 'Check plant placement against the approved concept.', photos: [] },
      { id: 'job-5', title: 'Median irrigation inspection', placeId: 'place-5', date: day(-1), time: '07:00', status: 'Overdue', type: 'Maintenance', crewIds: ['worker-1', 'worker-3'], vehicleId: 'vehicle-3', tasks: [{ text: 'Inspect pipes and sprinkler heads', done: false }, { text: 'Replace damaged connectors', done: false }], deadline: day(-1), budget: 1600, notes: 'Rescheduled due to heavy rain. Confirm new visit time.', photos: [] },
      { id: 'job-6', title: 'Weekly courtyard care', placeId: 'place-6', date: day(2), time: '09:00', status: 'Scheduled', type: 'Maintenance', crewIds: ['worker-2', 'worker-3'], vehicleId: 'vehicle-1', tasks: [{ text: 'Water, weed and tidy courtyard', done: false }], deadline: day(2), budget: 950, notes: '', photos: [] },
      { id: 'job-7', title: 'Hedge shaping & seasonal feeding', placeId: 'place-1', date: day(-3), time: '08:00', status: 'Completed', type: 'Maintenance', crewIds: ['worker-1', 'worker-2'], vehicleId: 'vehicle-1', tasks: [{ text: 'Shape hedges', done: true }, { text: 'Apply slow-release fertiliser', done: true }], deadline: day(-3), budget: 1200, notes: 'Client happy with the finished shape.', photos: [] },
    ],
    inventory: [
      { id: 'plant-1', name: 'Monstera deliciosa', category: 'Plants', quantity: 24, unit: 'plants', minStock: 8, cost: 85, image: plants.monstera, notes: 'Partial shade · water weekly', scientificName: 'Monstera deliciosa' },
      { id: 'plant-2', name: 'Areca palm', category: 'Plants', quantity: 18, unit: 'plants', minStock: 6, cost: 120, image: plants.palm, notes: 'Bright indirect light · moist soil', scientificName: 'Dypsis lutescens' },
      { id: 'plant-3', name: 'Snake plant', category: 'Plants', quantity: 32, unit: 'plants', minStock: 10, cost: 65, image: plants.snake, notes: 'Low maintenance · avoid overwatering', scientificName: 'Dracaena trifasciata' },
      { id: 'plant-4', name: 'Peace lily', category: 'Plants', quantity: 6, unit: 'plants', minStock: 8, cost: 75, image: plants.peace, notes: 'Shade · water when topsoil dries', scientificName: 'Spathiphyllum' },
      { id: 'plant-5', name: 'Fiddle-leaf fig', category: 'Plants', quantity: 14, unit: 'plants', minStock: 5, cost: 95, image: plants.ficus, notes: 'Bright indirect light · rotate regularly', scientificName: 'Ficus lyrata' },
      { id: 'plant-6', name: 'Croton', category: 'Plants', quantity: 22, unit: 'plants', minStock: 8, cost: 55, image: plants.croton, notes: 'Bright light · consistent watering', scientificName: 'Codiaeum variegatum' },
      { id: 'plant-7', name: 'Boston fern', category: 'Plants', quantity: 4, unit: 'plants', minStock: 6, cost: 60, image: plants.fern, notes: 'Filtered light · keep humid', scientificName: 'Nephrolepis exaltata' },
      { id: 'plant-8', name: 'Aloe vera', category: 'Plants', quantity: 40, unit: 'plants', minStock: 12, cost: 35, image: plants.aloe, notes: 'Bright light · allow soil to dry', scientificName: 'Aloe barbadensis miller' },
      { id: 'material-1', name: 'Organic potting mix', category: 'Materials', quantity: 12, unit: 'bags', minStock: 5, cost: 90, image: '', notes: '25 litre bags' },
      { id: 'material-2', name: 'Terracotta planter', category: 'Materials', quantity: 8, unit: 'pots', minStock: 4, cost: 150, image: '', notes: 'Medium, 35cm diameter' },
      { id: 'tool-1', name: 'Pruning shears', category: 'Tools', quantity: 6, unit: 'tools', minStock: 2, cost: 130, image: '', notes: 'Clean after every visit. Checkout recorded through stock usage.' },
    ],
    stockMovements: [],
    contracts: [
      { id: 'contract-1', placeId: 'place-1', title: 'Weekly garden care', frequency: 'Weekly', amount: 1800, startDate: day(-80), renewalDate: day(10), status: 'Active', notes: 'Includes watering, pruning, lawn care and fertiliser.' },
      { id: 'contract-2', placeId: 'place-2', title: 'Hotel grounds maintenance', frequency: 'Twice weekly', amount: 5200, startDate: day(-60), renewalDate: day(30), status: 'Active', notes: 'Entrance, courtyard and poolside planting.' },
      { id: 'contract-3', placeId: 'place-6', title: 'Courtyard maintenance', frequency: 'Weekly', amount: 950, startDate: day(-30), renewalDate: day(5), status: 'Active', notes: 'Visit every Tuesday morning.' },
    ],
    payments: [
      { id: 'payment-1', placeId: 'place-2', description: 'Entrance planting deposit', amount: 6000, dueDate: day(-3), status: 'Paid', paidDate: day(-4) },
      { id: 'payment-2', placeId: 'place-4', description: 'Courtyard installation deposit', amount: 4250, dueDate: day(2), status: 'Unpaid' },
      { id: 'payment-3', placeId: 'place-1', description: 'Monthly garden maintenance', amount: 1800, dueDate: day(-2), status: 'Unpaid' },
      { id: 'payment-4', placeId: 'place-3', description: 'Roundabout maintenance', amount: 2200, dueDate: day(7), status: 'Unpaid' },
    ],
    expenses: [
      { id: 'expense-1', jobId: 'job-2', category: 'Labour', description: 'Installation crew', amount: 1200, date: day(0) },
      { id: 'expense-2', jobId: 'job-2', category: 'Transport', description: 'Materials delivery', amount: 350, date: day(0) },
      { id: 'expense-3', jobId: 'job-7', category: 'Fuel', description: 'Crew fuel', amount: 180, date: day(-3) },
    ],
    purchaseRequests: [
      { id: 'purchase-1', title: 'Peace lily plants', quantity: 20, estimatedCost: 1500, status: 'Pending', requestedBy: 'Manager', date: day(0), notes: 'Stock below minimum; needed for upcoming hotel work.' },
      { id: 'purchase-2', title: 'Replacement irrigation connectors', quantity: 12, estimatedCost: 240, status: 'Approved', requestedBy: 'Manager', date: day(-2), notes: 'For Osu median repair.' },
    ],
    equipment: [
      { id: 'equipment-1', name: 'Honda lawn mower', type: 'Mower', status: 'Good', assignedTo: 'Store', lastService: day(-28), nextService: day(2), notes: 'Clean blade after use.' },
      { id: 'equipment-2', name: 'Hedge trimmer', type: 'Trimmer', status: 'Good', assignedTo: 'Kwame Asante', lastService: day(-50), nextService: day(12), notes: 'Assigned to Kwame’s crew.' },
      { id: 'equipment-3', name: 'Water pump', type: 'Pump', status: 'Needs service', assignedTo: 'Store', lastService: day(-95), nextService: day(-5), notes: 'Pressure drops during extended use.' },
    ],
    issues: [
      { id: 'issue-1', placeId: 'place-1', title: 'Dry patches near the terrace', type: 'Inspection finding', priority: 'Normal', status: 'Open', date: day(-1), description: 'Check drip irrigation and soil moisture during next visit.', notes: 'Check drip irrigation and soil moisture during next visit.', assignedTo: 'Kwame Asante', followUpDate: day(0), photos: [] },
      { id: 'issue-2', placeId: 'place-2', title: 'Add more flowering plants at entrance', type: 'Request', priority: 'Normal', status: 'In progress', date: day(-2), description: 'Client requested warmer colours. Prepare a concept for approval.', notes: 'Client requested warmer colours. Prepare a concept for approval.', assignedTo: 'Manager', followUpDate: day(2), photos: [] },
    ],
    careGuides: [
      { id: 'care-1', name: 'Monstera deliciosa', watering: 'Water when the top 3–5cm of soil feels dry.', light: 'Bright, indirect light; avoid harsh midday sun.', pruning: 'Remove yellow leaves and wipe foliage monthly.', feeding: 'Balanced fertiliser monthly during active growth.', inventoryId: 'plant-1' },
      { id: 'care-2', name: 'Areca palm', watering: 'Keep soil lightly moist, with good drainage.', light: 'Bright filtered light or partial shade.', pruning: 'Remove fully brown fronds at the base.', feeding: 'Palm fertiliser every 6–8 weeks during growth.', inventoryId: 'plant-2' },
      { id: 'care-3', name: 'Snake plant', watering: 'Let soil dry fully between watering.', light: 'Tolerates shade; grows best in bright indirect light.', pruning: 'Remove damaged leaves at soil level.', feeding: 'Light feeding every 2–3 months.', inventoryId: 'plant-3' },
    ],
    designs: [],
  };
}
