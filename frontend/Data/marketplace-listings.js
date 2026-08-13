/* =========================================================================
   Marketplace demo produce listings — MittiMantra Marketplace
   -------------------------------------------------------------------------
   DEMO_DATA: clearly-labelled sample listings for the prototype, in the same
   spirit as Data/tractors.js and Data/consultants.js. Not live transactions.

   crop_id values match backend dataset/crop_parameters.csv and
   dataset/mandi_prices.csv so the "Market Insight" panel in marketplace.js
   can look up real reference prices via the existing /api/mandi-prices and
   /api/msp-vs-market endpoints — no fabricated market data.

   region_id / state / lat / lon match frontend/farm-state.js REGION_CENTROIDS
   so distance-from-farm and "nearest region" logic stays consistent across
   the whole app.
   ========================================================================= */

window.MARKETPLACE_DATA = {
  source: "DEMO_DATA",
  listings: [
    { id: "mkt_001", cropId: "rice", image: "assets/marketplace/rice.webp", category: "grains", name: "Rice", variety: "Sona Masuri", grade: "Grade A", organic: false,
      description: "Well-dried, machine-cleaned Sona Masuri paddy rice. Stored in a dry godown, ready for immediate pickup.",
      quantityAvailable: 85, unit: "quintal", minOrderQty: 5, pricePerUnit: 3200,
      harvestDate: "2026-08-01", expectedAvailability: "2026-08-05",
      regionId: "telangana_medak", state: "Telangana", district: "Medak", village: "Ramayampet", lat: 18.04, lon: 78.26,
      sellerId: "s_venkat", sellerName: "Venkat Reddy", sellerType: "farmer", verified: true,
      sellerRating: 4.7, sellerOrders: 23, sellerSince: "2023", sellerResponseRate: 92,
      status: "active", createdAt: "2026-08-06" },

    { id: "mkt_002", cropId: "paddy_basmati", image: "assets/marketplace/paddy_basmati.webp", category: "grains", name: "Basmati Rice", variety: "Pusa 1121", grade: "Premium", organic: false,
      description: "Long-grain Pusa 1121 basmati, aged 3 months for aroma. Sample available on request.",
      quantityAvailable: 40, unit: "quintal", minOrderQty: 3, pricePerUnit: 5400,
      harvestDate: "2026-05-20", expectedAvailability: "2026-06-01",
      regionId: "haryana_karnal", state: "Haryana", district: "Karnal", village: "Nissing", lat: 29.69, lon: 76.99,
      sellerId: "s_jagdish", sellerName: "Jagdish Singh", sellerType: "farmer", verified: true,
      sellerRating: 4.9, sellerOrders: 41, sellerSince: "2021", sellerResponseRate: 96,
      status: "active", createdAt: "2026-06-10" },

    { id: "mkt_003", cropId: "wheat", image: "assets/marketplace/wheat.webp", category: "grains", name: "Wheat", variety: "HD-2967", grade: "Grade A", organic: false,
      description: "Bold-grain milling wheat, low moisture, cleaned and bagged in 50kg sacks.",
      quantityAvailable: 220, unit: "quintal", minOrderQty: 10, pricePerUnit: 2450,
      harvestDate: "2026-04-10", expectedAvailability: "2026-04-15",
      regionId: "punjab_ludhiana", state: "Punjab", district: "Ludhiana", village: "Sahnewal", lat: 30.90, lon: 75.85,
      sellerId: "s_harpreet", sellerName: "Harpreet Kaur", sellerType: "farmer", verified: true,
      sellerRating: 4.8, sellerOrders: 55, sellerSince: "2020", sellerResponseRate: 98,
      status: "active", createdAt: "2026-04-18" },

    { id: "mkt_004", cropId: "wheat", image: "assets/marketplace/wheat.webp", category: "grains", name: "Wheat", variety: "Local Sharbati", grade: "Grade B", organic: false,
      description: "Standard sharbati wheat from a small joint holding, good for chakki atta.",
      quantityAvailable: 60, unit: "quintal", minOrderQty: 5, pricePerUnit: 2200,
      harvestDate: "2026-04-05", expectedAvailability: "2026-04-10",
      regionId: "mp_sehore", state: "Madhya Pradesh", district: "Sehore", village: "Ichhawar", lat: 23.20, lon: 77.08,
      sellerId: "s_ramesh", sellerName: "Ramesh Kumar", sellerType: "farmer", verified: false,
      sellerRating: 4.2, sellerOrders: 6, sellerSince: "2025", sellerResponseRate: 70,
      status: "active", createdAt: "2026-04-20" },

    { id: "mkt_005", cropId: "cotton", image: "assets/marketplace/cotton.webp", category: "cotton", name: "Cotton", variety: "Bt Cotton (Shankar-6)", grade: "Grade A", organic: false,
      description: "Machine-picked Bt cotton, moisture-checked below 8%, ginned quality lint.",
      quantityAvailable: 65, unit: "quintal", minOrderQty: 5, pricePerUnit: 7100,
      harvestDate: "2026-07-25", expectedAvailability: "2026-08-01",
      regionId: "guj_rajkot", state: "Gujarat", district: "Rajkot", village: "Gondal", lat: 22.30, lon: 70.80,
      sellerId: "s_bharat", sellerName: "Bharat Patel", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 30, sellerSince: "2022", sellerResponseRate: 88,
      status: "active", createdAt: "2026-08-03" },

    { id: "mkt_006", cropId: "cotton", image: "assets/marketplace/cotton.webp", category: "cotton", name: "Cotton", variety: "Desi Cotton", grade: "Standard", organic: false,
      description: "Rainfed desi cotton, hand-picked in small batches across the season.",
      quantityAvailable: 18, unit: "quintal", minOrderQty: 2, pricePerUnit: 6600,
      harvestDate: "2026-07-15", expectedAvailability: "2026-07-20",
      regionId: "mh_yavatmal", state: "Maharashtra", district: "Yavatmal", village: "Pusad", lat: 20.38, lon: 78.12,
      sellerId: "s_sunita2", sellerName: "Sunita Jadhav", sellerType: "farmer", verified: true,
      sellerRating: 4.4, sellerOrders: 14, sellerSince: "2023", sellerResponseRate: 80,
      status: "limited", createdAt: "2026-07-22" },

    { id: "mkt_007", cropId: "maize", image: "assets/marketplace/maize.webp", category: "grains", name: "Maize", variety: "Hybrid Yellow Maize", grade: "Grade A", organic: false,
      description: "Sun-dried hybrid yellow maize, poultry-feed grade, aflatoxin tested.",
      quantityAvailable: 150, unit: "quintal", minOrderQty: 10, pricePerUnit: 2050,
      harvestDate: "2026-07-10", expectedAvailability: "2026-07-15",
      regionId: "kar_belagavi", state: "Karnataka", district: "Belagavi", village: "Gokak", lat: 15.85, lon: 74.50,
      sellerId: "s_basavaraj", sellerName: "Basavaraj Hiremath", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 19, sellerSince: "2022", sellerResponseRate: 85,
      status: "active", createdAt: "2026-07-18" },

    { id: "mkt_008", cropId: "soybean", image: "assets/marketplace/soybean.webp", category: "oilseeds", name: "Soybean", variety: "JS-335", grade: "Grade A", organic: false,
      description: "Clean, well-graded soybean with low foreign matter — oil-mill ready.",
      quantityAvailable: 95, unit: "quintal", minOrderQty: 5, pricePerUnit: 4650,
      harvestDate: "2026-10-05", expectedAvailability: "2026-10-10",
      regionId: "mp_indore", state: "Madhya Pradesh", district: "Indore", village: "Depalpur", lat: 22.72, lon: 75.86,
      sellerId: "s_omprakash", sellerName: "Omprakash Verma", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 27, sellerSince: "2021", sellerResponseRate: 90,
      status: "active", createdAt: "2026-08-01" },

    { id: "mkt_009", cropId: "groundnut", image: "assets/marketplace/groundnut.webp", category: "oilseeds", name: "Groundnut", variety: "TAG-24 Bold", grade: "Premium", organic: false,
      description: "Bold-seeded groundnut, sun-dried to 8% moisture, hand-sorted for size.",
      quantityAvailable: 45, unit: "quintal", minOrderQty: 3, pricePerUnit: 5900,
      harvestDate: "2026-10-20", expectedAvailability: "2026-10-25",
      regionId: "guj_anand", state: "Gujarat", district: "Anand", village: "Petlad", lat: 22.56, lon: 72.95,
      sellerId: "s_dinesh", sellerName: "Dinesh Chaudhary", sellerType: "farmer", verified: true,
      sellerRating: 4.7, sellerOrders: 22, sellerSince: "2022", sellerResponseRate: 91,
      status: "active", createdAt: "2026-10-28" },

    { id: "mkt_010", cropId: "mustard", image: "assets/marketplace/mustard.webp", category: "oilseeds", name: "Mustard", variety: "Pusa Bold", grade: "Grade A", organic: false,
      description: "High oil-content mustard seed, cleaned and free of chaff.",
      quantityAvailable: 70, unit: "quintal", minOrderQty: 5, pricePerUnit: 6100,
      harvestDate: "2026-03-15", expectedAvailability: "2026-03-20",
      regionId: "rajasthan_jaipur", state: "Rajasthan", district: "Jaipur", village: "Chomu", lat: 26.91, lon: 75.79,
      sellerId: "s_mahendra", sellerName: "Mahendra Yadav", sellerType: "farmer", verified: false,
      sellerRating: 4.1, sellerOrders: 8, sellerSince: "2024", sellerResponseRate: 68,
      status: "active", createdAt: "2026-03-25" },

    { id: "mkt_011", cropId: "tomato", image: "assets/marketplace/tomato.webp", category: "vegetables", name: "Tomato", variety: "Hybrid Red Round", grade: "Grade A", organic: false,
      description: "Freshly harvested farm tomatoes, firm and uniform-sized, ideal for wholesale/HoReCa.",
      quantityAvailable: 30, unit: "quintal", minOrderQty: 2, pricePerUnit: 1800,
      harvestDate: "2026-08-12", expectedAvailability: "2026-08-13",
      regionId: "mh_nashik", state: "Maharashtra", district: "Nashik", village: "Niphad", lat: 19.99, lon: 73.79,
      sellerId: "s_anita", sellerName: "Anita More", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 34, sellerSince: "2022", sellerResponseRate: 89,
      status: "active", createdAt: "2026-08-12" },

    { id: "mkt_012", cropId: "onion", image: "assets/marketplace/onion.webp", category: "vegetables", name: "Onion", variety: "Nashik Red", grade: "Grade A", organic: false,
      description: "Well-cured red onions, medium bulb size, low moisture for good shelf life.",
      quantityAvailable: 180, unit: "quintal", minOrderQty: 10, pricePerUnit: 2100,
      harvestDate: "2026-04-01", expectedAvailability: "2026-04-05",
      regionId: "mh_nashik", state: "Maharashtra", district: "Nashik", village: "Lasalgaon", lat: 19.99, lon: 73.79,
      sellerId: "s_ganesh", sellerName: "Ganesh Pawar", sellerType: "farmer", verified: true,
      sellerRating: 4.8, sellerOrders: 61, sellerSince: "2020", sellerResponseRate: 95,
      status: "active", createdAt: "2026-04-08" },

    { id: "mkt_013", cropId: "potato", image: "assets/marketplace/potato.webp", category: "vegetables", name: "Potato", variety: "Kufri Jyoti", grade: "Grade B", organic: false,
      description: "Cold-store potato, medium size, good for chips and household use.",
      quantityAvailable: 12, unit: "quintal", minOrderQty: 2, pricePerUnit: 1500,
      harvestDate: "2026-02-20", expectedAvailability: "2026-02-25",
      regionId: "up_lucknow", state: "Uttar Pradesh", district: "Lucknow", village: "Malihabad", lat: 26.85, lon: 80.94,
      sellerId: "s_sunita", sellerName: "Sunita Devi", sellerType: "farmer", verified: true,
      sellerRating: 4.3, sellerOrders: 17, sellerSince: "2023", sellerResponseRate: 82,
      status: "limited", createdAt: "2026-08-02" },

    { id: "mkt_014", cropId: "chilli", image: "assets/marketplace/chilli.webp", category: "spices", name: "Chilli", variety: "Guntur Sannam", grade: "Premium", organic: false,
      description: "Sun-dried Guntur Sannam red chillies, high pungency, hand-picked stems removed.",
      quantityAvailable: 25, unit: "quintal", minOrderQty: 1, pricePerUnit: 18500,
      harvestDate: "2026-02-10", expectedAvailability: "2026-02-15",
      regionId: "ap_guntur", state: "Andhra Pradesh", district: "Guntur", village: "Vinukonda", lat: 16.30, lon: 80.44,
      sellerId: "s_prasad", sellerName: "Prasad Rao", sellerType: "farmer", verified: true,
      sellerRating: 4.9, sellerOrders: 48, sellerSince: "2021", sellerResponseRate: 97,
      status: "active", createdAt: "2026-02-18" },

    { id: "mkt_015", cropId: "turmeric", image: "assets/marketplace/turmeric.webp", category: "spices", name: "Turmeric", variety: "Salem Finger", grade: "Grade A", organic: true,
      description: "Boiled, polished turmeric fingers with high curcumin content. Organically grown.",
      quantityAvailable: 20, unit: "quintal", minOrderQty: 1, pricePerUnit: 11500,
      harvestDate: "2026-03-01", expectedAvailability: "2026-03-10",
      regionId: "tn_coimbatore", state: "Tamil Nadu", district: "Coimbatore", village: "Erode Rd", lat: 11.01, lon: 76.97,
      sellerId: "s_murugan", sellerName: "Murugan S.", sellerType: "farmer", verified: true,
      sellerRating: 4.7, sellerOrders: 25, sellerSince: "2022", sellerResponseRate: 90,
      status: "active", createdAt: "2026-03-15" },

    { id: "mkt_016", cropId: "sugarcane", image: "assets/marketplace/sugarcane.webp", category: "other", name: "Sugarcane", variety: "Co-0238", grade: "Standard", organic: false,
      description: "Fresh-cut sugarcane, high sucrose content, ready for mill delivery.",
      quantityAvailable: 480, unit: "quintal", minOrderQty: 50, pricePerUnit: 350,
      harvestDate: "2026-08-10", expectedAvailability: "2026-08-11",
      regionId: "up_varanasi", state: "Uttar Pradesh", district: "Varanasi", village: "Ramnagar", lat: 25.32, lon: 83.01,
      sellerId: "s_shivkumar", sellerName: "Shiv Kumar Yadav", sellerType: "farmer", verified: true,
      sellerRating: 4.4, sellerOrders: 12, sellerSince: "2023", sellerResponseRate: 78,
      status: "active", createdAt: "2026-08-11" },

    { id: "mkt_017", cropId: "arhar", image: "assets/marketplace/arhar.webp", category: "pulses", name: "Arhar (Tur) Dal", variety: "ICPL-87", grade: "Grade A", organic: false,
      description: "Well-dried tur/arhar grain, low breakage, cleaned for dal milling.",
      quantityAvailable: 38, unit: "quintal", minOrderQty: 3, pricePerUnit: 8200,
      harvestDate: "2026-01-15", expectedAvailability: "2026-01-20",
      regionId: "mh_pune", state: "Maharashtra", district: "Pune", village: "Baramati", lat: 18.52, lon: 73.86,
      sellerId: "s_vishal", sellerName: "Vishal Deshmukh", sellerType: "farmer", verified: false,
      sellerRating: 4.0, sellerOrders: 5, sellerSince: "2025", sellerResponseRate: 60,
      status: "active", createdAt: "2026-08-05" },

    { id: "mkt_018", cropId: "pulses", image: "assets/marketplace/pulses.webp", category: "pulses", name: "Chickpea (Chana)", variety: "Kabuli", grade: "Premium", organic: false,
      description: "Bold Kabuli chickpea, machine-cleaned, low split percentage.",
      quantityAvailable: 55, unit: "quintal", minOrderQty: 5, pricePerUnit: 7400,
      harvestDate: "2026-03-05", expectedAvailability: "2026-03-10",
      regionId: "mp_indore", state: "Madhya Pradesh", district: "Indore", village: "Mhow", lat: 22.72, lon: 75.86,
      sellerId: "s_omprakash", sellerName: "Omprakash Verma", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 27, sellerSince: "2021", sellerResponseRate: 90,
      status: "active", createdAt: "2026-03-14" },

    { id: "mkt_019", cropId: "moong", image: "assets/marketplace/moong.webp", category: "pulses", name: "Green Gram (Moong)", variety: "IPM-2-3", grade: "Grade A", organic: false,
      description: "Shiny green moong, bold grain, sourced from a single family farm.",
      quantityAvailable: 8, unit: "quintal", minOrderQty: 1, pricePerUnit: 8800,
      harvestDate: "2026-07-01", expectedAvailability: "2026-07-05",
      regionId: "haryana_karnal", state: "Haryana", district: "Karnal", village: "Indri", lat: 29.69, lon: 76.99,
      sellerId: "s_jagdish", sellerName: "Jagdish Singh", sellerType: "farmer", verified: true,
      sellerRating: 4.9, sellerOrders: 41, sellerSince: "2021", sellerResponseRate: 96,
      status: "limited", createdAt: "2026-07-08" },

    { id: "mkt_020", cropId: "banana", image: "assets/marketplace/banana.webp", category: "fruits", name: "Banana", variety: "Grand Naine", grade: "Grade A", organic: false,
      description: "Green-harvested Grand Naine bananas, uniform bunch size, transport-ready.",
      quantityAvailable: 300, unit: "quintal", minOrderQty: 20, pricePerUnit: 1600,
      harvestDate: "2026-08-08", expectedAvailability: "2026-08-09",
      regionId: "tn_thanjavur", state: "Tamil Nadu", district: "Thanjavur", village: "Pattukkottai", lat: 10.79, lon: 79.14,
      sellerId: "s_kannan", sellerName: "Kannan R.", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 20, sellerSince: "2022", sellerResponseRate: 84,
      status: "active", createdAt: "2026-08-09" },

    { id: "mkt_021", cropId: "mango", image: "assets/marketplace/mango.webp", category: "fruits", name: "Mango", variety: "Alphonso", grade: "Premium", organic: false,
      description: "Tree-ripened Alphonso mangoes, hand-picked and cushioned for transport.",
      quantityAvailable: 6, unit: "quintal", minOrderQty: 1, pricePerUnit: 9500,
      harvestDate: "2026-05-01", expectedAvailability: "2026-05-05",
      regionId: "mh_pune", state: "Maharashtra", district: "Pune", village: "Junnar", lat: 18.52, lon: 73.86,
      sellerId: "s_deepak", sellerName: "Deepak Kale", sellerType: "farmer", verified: true,
      sellerRating: 4.8, sellerOrders: 16, sellerSince: "2023", sellerResponseRate: 86,
      status: "sold_out", createdAt: "2026-05-10" },

    { id: "mkt_022", cropId: "jute", image: "assets/marketplace/jute.webp", category: "other", name: "Jute", variety: "TD-5", grade: "Grade B", organic: false,
      description: "Retted and dried jute fibre, bundled and ready for mill collection.",
      quantityAvailable: 90, unit: "quintal", minOrderQty: 5, pricePerUnit: 4700,
      harvestDate: "2026-09-20", expectedAvailability: "2026-09-25",
      regionId: "wb_bardhaman", state: "West Bengal", district: "Bardhaman", village: "Kalna", lat: 23.23, lon: 87.86,
      sellerId: "s_ashok", sellerName: "Ashok Mondal", sellerType: "farmer", verified: false,
      sellerRating: 4.0, sellerOrders: 4, sellerSince: "2025", sellerResponseRate: 55,
      status: "active", createdAt: "2026-09-28" },

    { id: "mkt_023", cropId: "bajra", image: "assets/marketplace/bajra.webp", category: "grains", name: "Pearl Millet (Bajra)", variety: "HHB-67", grade: "Grade A", organic: false,
      description: "Drought-grown bajra, cleaned and dried, popular for flour and poultry feed.",
      quantityAvailable: 110, unit: "quintal", minOrderQty: 10, pricePerUnit: 2600,
      harvestDate: "2026-10-01", expectedAvailability: "2026-10-05",
      regionId: "rajasthan_jaipur", state: "Rajasthan", district: "Jaipur", village: "Phulera", lat: 26.91, lon: 75.79,
      sellerId: "s_mahendra", sellerName: "Mahendra Yadav", sellerType: "farmer", verified: false,
      sellerRating: 4.1, sellerOrders: 8, sellerSince: "2024", sellerResponseRate: 68,
      status: "active", createdAt: "2026-10-08" },

    { id: "mkt_024", cropId: "jowar", image: "assets/marketplace/jowar.webp", category: "grains", name: "Sorghum (Jowar)", variety: "M-35-1", grade: "Standard", organic: false,
      description: "White jowar grain, good for roti flour, dried to storage moisture.",
      quantityAvailable: 75, unit: "quintal", minOrderQty: 5, pricePerUnit: 3100,
      harvestDate: "2026-10-15", expectedAvailability: "2026-10-20",
      regionId: "mh_yavatmal", state: "Maharashtra", district: "Yavatmal", village: "Darwha", lat: 20.38, lon: 78.12,
      sellerId: "s_sunita2", sellerName: "Sunita Jadhav", sellerType: "farmer", verified: true,
      sellerRating: 4.4, sellerOrders: 14, sellerSince: "2023", sellerResponseRate: 80,
      status: "active", createdAt: "2026-10-22" },

    { id: "mkt_025", cropId: "coconut", image: "assets/marketplace/coconut.webp", category: "other", name: "Coconut", variety: "West Coast Tall", grade: "Grade A", organic: false,
      description: "Mature coconuts, husked and ready for copra or direct sale, harvested weekly.",
      quantityAvailable: 500, unit: "quintal", minOrderQty: 20, pricePerUnit: 2200,
      harvestDate: "2026-08-11", expectedAvailability: "2026-08-12",
      regionId: "kerala_palakkad", state: "Kerala", district: "Palakkad", village: "Ottapalam", lat: 10.77, lon: 76.65,
      sellerId: "s_thomas", sellerName: "Thomas Varghese", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 29, sellerSince: "2021", sellerResponseRate: 88,
      status: "active", createdAt: "2026-08-12" },

    { id: "mkt_026", cropId: "sunflower", image: "assets/marketplace/sunflower.webp", category: "oilseeds", name: "Sunflower", variety: "KBSH-1", grade: "Grade A", organic: false,
      description: "Bold sunflower seed, high oil content, cleaned of husk and debris.",
      quantityAvailable: 42, unit: "quintal", minOrderQty: 3, pricePerUnit: 6200,
      harvestDate: "2026-03-20", expectedAvailability: "2026-03-25",
      regionId: "kar_mysuru", state: "Karnataka", district: "Mysuru", village: "Nanjangud", lat: 12.30, lon: 76.64,
      sellerId: "s_puttaraju", sellerName: "Puttaraju K.", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 18, sellerSince: "2022", sellerResponseRate: 83,
      status: "active", createdAt: "2026-03-28" },

    { id: "mkt_027", cropId: "ragi", image: "assets/marketplace/ragi.webp", category: "grains", name: "Finger Millet (Ragi)", variety: "Indaf-9", grade: "Grade A", organic: true,
      description: "Organic ragi, stone-ground quality grain, minimal chemical input.",
      quantityAvailable: 28, unit: "quintal", minOrderQty: 2, pricePerUnit: 4200,
      harvestDate: "2026-11-05", expectedAvailability: "2026-11-10",
      regionId: "kar_mysuru", state: "Karnataka", district: "Mysuru", village: "T. Narsipur", lat: 12.30, lon: 76.64,
      sellerId: "s_puttaraju", sellerName: "Puttaraju K.", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 18, sellerSince: "2022", sellerResponseRate: 83,
      status: "active", createdAt: "2026-11-12" },

    { id: "mkt_028", cropId: "rice", image: "assets/marketplace/rice.webp", category: "grains", name: "Rice", variety: "Swarna", grade: "Standard", organic: false,
      description: "Bulk paddy rice for wholesale traders, sold as harvested (unpolished).",
      quantityAvailable: 320, unit: "quintal", minOrderQty: 25, pricePerUnit: 2600,
      harvestDate: "2026-11-20", expectedAvailability: "2026-11-25",
      regionId: "odisha_cuttack", state: "Odisha", district: "Cuttack", village: "Athagarh", lat: 20.46, lon: 85.88,
      sellerId: "s_bijay", sellerName: "Bijay Mohapatra", sellerType: "farmer", verified: true,
      sellerRating: 4.3, sellerOrders: 21, sellerSince: "2022", sellerResponseRate: 79,
      status: "active", createdAt: "2026-11-27" },

    { id: "mkt_029", cropId: "wheat", image: "assets/marketplace/wheat.webp", category: "grains", name: "Wheat", variety: "Lok-1", grade: "Grade A", organic: true,
      description: "Certified-organic wheat, third-party inspected, grown without synthetic inputs.",
      quantityAvailable: 50, unit: "quintal", minOrderQty: 5, pricePerUnit: 3100,
      harvestDate: "2026-04-12", expectedAvailability: "2026-04-18",
      regionId: "chhattisgarh_raipur", state: "Chhattisgarh", district: "Raipur", village: "Abhanpur", lat: 21.25, lon: 81.63,
      sellerId: "s_rajkumar", sellerName: "Rajkumar Sahu", sellerType: "farmer", verified: true,
      sellerRating: 4.7, sellerOrders: 15, sellerSince: "2023", sellerResponseRate: 87,
      status: "active", createdAt: "2026-04-22" },

    { id: "mkt_030", cropId: "groundnut", image: "assets/marketplace/groundnut.webp", category: "oilseeds", name: "Groundnut", variety: "GG-20", grade: "Grade B", organic: false,
      description: "Machine-shelled groundnut kernels, mixed size, good for oil extraction.",
      quantityAvailable: 15, unit: "quintal", minOrderQty: 2, pricePerUnit: 4900,
      harvestDate: "2026-10-25", expectedAvailability: "2026-10-30",
      regionId: "guj_rajkot", state: "Gujarat", district: "Rajkot", village: "Jasdan", lat: 22.30, lon: 70.80,
      sellerId: "s_bharat", sellerName: "Bharat Patel", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 30, sellerSince: "2022", sellerResponseRate: 88,
      status: "limited", createdAt: "2026-11-02" },

    { id: "mkt_031", cropId: "tomato", image: "assets/marketplace/tomato.webp", category: "vegetables", name: "Tomato", variety: "Desi Local", grade: "Standard", organic: true,
      description: "Small-batch organic desi tomatoes, grown for the local mandi and direct sale.",
      quantityAvailable: 4, unit: "quintal", minOrderQty: 1, pricePerUnit: 1600,
      harvestDate: "2026-08-13", expectedAvailability: "2026-08-14",
      regionId: "jharkhand_ranchi", state: "Jharkhand", district: "Ranchi", village: "Ormanjhi", lat: 23.36, lon: 85.33,
      sellerId: "s_birsa", sellerName: "Birsa Munda (FPO)", sellerType: "fpo", verified: true,
      sellerRating: 4.6, sellerOrders: 11, sellerSince: "2024", sellerResponseRate: 81,
      status: "limited", createdAt: "2026-08-13" },

    { id: "mkt_032", cropId: "maize", image: "assets/marketplace/maize.webp", category: "grains", name: "Maize", variety: "Desi White Maize", grade: "Grade B", organic: false,
      description: "White maize grown mixed with pulses, hand-shelled and dried on farm.",
      quantityAvailable: 0, unit: "quintal", minOrderQty: 5, pricePerUnit: 1950,
      harvestDate: "2026-06-15", expectedAvailability: "2026-06-20",
      regionId: "assam_nagaon", state: "Assam", district: "Nagaon", village: "Kaliabor", lat: 26.35, lon: 92.68,
      sellerId: "s_probin", sellerName: "Probin Boro", sellerType: "farmer", verified: false,
      sellerRating: 3.9, sellerOrders: 3, sellerSince: "2025", sellerResponseRate: 50,
      status: "sold_out", createdAt: "2026-06-25" },

    /* mkt_033/034 and mkt_035/036 are deliberately clustered near mkt_001 (rice,
       Medak) and mkt_011 (tomato, Nashik) respectively — every other demo listing
       above is spread across a different state for geographic diversity, which
       meant no two same-crop listings were ever close enough to pool together.
       These four exist so the Collective Selling / Pool Orders feature has real,
       immediately-browsable demo content instead of requiring a visitor to first
       create their own listing in the exact right district to ever see it. */
    { id: "mkt_033", cropId: "rice", image: "assets/marketplace/rice.webp", category: "grains", name: "Rice", variety: "Sona Masuri", grade: "Grade A", organic: false,
      description: "Small-holding Sona Masuri paddy, hand-harvested, dried on tarpaulin.",
      quantityAvailable: 22, unit: "quintal", minOrderQty: 5, pricePerUnit: 3150,
      harvestDate: "2026-08-02", expectedAvailability: "2026-08-06",
      regionId: "telangana_medak", state: "Telangana", district: "Medak", village: "Toopran", lat: 18.10, lon: 78.15,
      sellerId: "s_lakshmi", sellerName: "Lakshmi Narayana", sellerType: "farmer", verified: true,
      sellerRating: 4.5, sellerOrders: 12, sellerSince: "2023", sellerResponseRate: 84,
      status: "active", createdAt: "2026-08-06" },

    { id: "mkt_034", cropId: "rice", image: "assets/marketplace/rice.webp", category: "grains", name: "Rice", variety: "Sona Masuri", grade: "Grade B", organic: false,
      description: "Rainfed Sona Masuri from a joint family holding, sun-dried in small batches.",
      quantityAvailable: 15, unit: "quintal", minOrderQty: 3, pricePerUnit: 3050,
      harvestDate: "2026-07-30", expectedAvailability: "2026-08-04",
      regionId: "telangana_medak", state: "Telangana", district: "Medak", village: "Narsapur", lat: 17.95, lon: 78.35,
      sellerId: "s_ravikumar", sellerName: "Ravi Kumar Goud", sellerType: "farmer", verified: false,
      sellerRating: 4.2, sellerOrders: 7, sellerSince: "2024", sellerResponseRate: 74,
      status: "active", createdAt: "2026-08-05" },

    { id: "mkt_035", cropId: "tomato", image: "assets/marketplace/tomato.webp", category: "vegetables", name: "Tomato", variety: "Hybrid Red Round", grade: "Grade A", organic: false,
      description: "Freshly picked tomatoes from a small plot, sorted by hand, transport-ready.",
      quantityAvailable: 9, unit: "quintal", minOrderQty: 1, pricePerUnit: 1750,
      harvestDate: "2026-08-11", expectedAvailability: "2026-08-13",
      regionId: "mh_nashik", state: "Maharashtra", district: "Nashik", village: "Dindori", lat: 20.05, lon: 73.70,
      sellerId: "s_suresh", sellerName: "Suresh Gaikwad", sellerType: "farmer", verified: true,
      sellerRating: 4.4, sellerOrders: 16, sellerSince: "2022", sellerResponseRate: 85,
      status: "active", createdAt: "2026-08-13" },

    { id: "mkt_036", cropId: "tomato", image: "assets/marketplace/tomato.webp", category: "vegetables", name: "Tomato", variety: "Hybrid Red Round", grade: "Grade A", organic: false,
      description: "Small-batch tomato harvest, graded for uniform size, ready for immediate pickup.",
      quantityAvailable: 6, unit: "quintal", minOrderQty: 1, pricePerUnit: 1700,
      harvestDate: "2026-08-12", expectedAvailability: "2026-08-14",
      regionId: "mh_nashik", state: "Maharashtra", district: "Nashik", village: "Igatpuri", lat: 19.90, lon: 73.90,
      sellerId: "s_meera", sellerName: "Meera Shinde", sellerType: "farmer", verified: false,
      sellerRating: 4.3, sellerOrders: 9, sellerSince: "2024", sellerResponseRate: 79,
      status: "active", createdAt: "2026-08-14" },

    /* mkt_037 has a harvestDate still in the future — this is what
       automatically makes a listing a Forward Booking (see isForwardListing
       in marketplace.js), so the feature has one real, immediately-browsable
       example instead of requiring a visitor to create their own future-dated
       listing first to ever see it. */
    { id: "mkt_037", cropId: "wheat", image: "assets/marketplace/wheat.webp", category: "grains", name: "Wheat", variety: "HD-3086", grade: "Grade A", organic: false,
      description: "Rabi wheat sown in October — offered now as a forward booking ahead of the November harvest, so buyers can lock in supply and price early.",
      quantityAvailable: 120, unit: "quintal", minOrderQty: 10, pricePerUnit: 2500,
      harvestDate: "2026-11-20", expectedAvailability: "2026-11-25",
      regionId: "punjab_ludhiana", state: "Punjab", district: "Ludhiana", village: "Machhiwara", lat: 30.80, lon: 76.20,
      sellerId: "s_gurpreet", sellerName: "Gurpreet Singh", sellerType: "farmer", verified: true,
      sellerRating: 4.6, sellerOrders: 24, sellerSince: "2021", sellerResponseRate: 91,
      status: "active", createdAt: "2026-08-14" }
  ],

  /* Demo "Pool Orders" — pre-existing pools among the clustered listings above,
     so Collective Selling has real content to browse immediately (createdBy:
     "demo" marks these as illustrative reference data, same spirit as the demo
     listings/demand signals; a real farmer's pool is created on-device from
     My Listings and stored separately, never mixed into this static list). */
  pools: [
    { id: "pool_demo_rice_medak", cropId: "rice", cropName: "Rice",
      memberListingIds: ["mkt_001", "mkt_033", "mkt_034"],
      createdBy: "demo", createdAt: "2026-08-06T00:00:00Z" },
    { id: "pool_demo_tomato_nashik", cropId: "tomato", cropName: "Tomato",
      memberListingIds: ["mkt_011", "mkt_035", "mkt_036"],
      createdBy: "demo", createdAt: "2026-08-13T00:00:00Z" }
  ],

  /* Demo "Nearby Demand" signals — illustrative only, not live buyer data.
     Shown clearly labelled as a demo in the Marketplace UI. */
  demand: [
    { cropId: "rice", image: "assets/marketplace/rice.webp", name: "Rice", buyerCount: 12, priceRangeLow: 2850, priceRangeHigh: 3100, totalRequestedQuintal: 420, nearestBuyerKm: 18, lat: 18.04, lon: 78.26, state: "Telangana" },
    { cropId: "wheat", image: "assets/marketplace/wheat.webp", name: "Wheat", buyerCount: 9, priceRangeLow: 2150, priceRangeHigh: 2400, totalRequestedQuintal: 310, nearestBuyerKm: 24, lat: 30.90, lon: 75.85, state: "Punjab" },
    { cropId: "cotton", image: "assets/marketplace/cotton.webp", name: "Cotton", buyerCount: 6, priceRangeLow: 6800, priceRangeHigh: 7300, totalRequestedQuintal: 140, nearestBuyerKm: 32, lat: 22.30, lon: 70.80, state: "Gujarat" },
    { cropId: "onion", image: "assets/marketplace/onion.webp", name: "Onion", buyerCount: 8, priceRangeLow: 1900, priceRangeHigh: 2200, totalRequestedQuintal: 260, nearestBuyerKm: 15, lat: 19.99, lon: 73.79, state: "Maharashtra" },
    { cropId: "soybean", image: "assets/marketplace/soybean.webp", name: "Soybean", buyerCount: 7, priceRangeLow: 4400, priceRangeHigh: 4800, totalRequestedQuintal: 190, nearestBuyerKm: 40, lat: 22.72, lon: 75.86, state: "Madhya Pradesh" },
    { cropId: "chilli", image: "assets/marketplace/chilli.webp", name: "Chilli", buyerCount: 5, priceRangeLow: 17500, priceRangeHigh: 19000, totalRequestedQuintal: 60, nearestBuyerKm: 55, lat: 16.30, lon: 80.44, state: "Andhra Pradesh" }
  ]
};
