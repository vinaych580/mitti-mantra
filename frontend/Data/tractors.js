/* =========================================================================
   Tractor rental data — MittiMantra "Book a Tractor" (upcoming feature)
   -------------------------------------------------------------------------
   This is the ONLY file you need to touch to add a tractor, change a price,
   tweak a performance score, or update specs/location. The page renderers
   (book-a-tractor.js, map-tractors.js) read this array and render everything
   with .map()/.filter() — no UI code needs to change.

   Fields:
     id              unique number
     name            display name
     image           photo URL (or local path under assets/)
     lat, lng        mock GPS coordinates (swap for real partner locations later)
     address         short human-readable location label for map popups/list
     hp              horsepower (number)
     suitableLand    land size this tractor suits, e.g. "2–8 acres"
     bestFor         short phrase, e.g. "Ploughing & general farm work"
     bestCrop        crop(s) this tractor is best suited for
     fuelType        "Diesel" | "Diesel (CRDe)"
     fuelEfficiency  short label, e.g. "3.6 L/hr"
     transmission    gearbox description
     pricePerHour    number (INR)
     pricePerDay     number (INR)
     rating          0–5, one decimal
     availability    "Available" | "Limited" | "Booked"
     description     1–2 sentence blurb for the card
     performance     { power, fuelEfficiency, loadCapacity, comfort } — all 0–100
     maintenanceCost "Low" | "Medium" | "High"
   ========================================================================= */

window.TRACTORS_DATA = [
  {
    id: 1,
    name: "Mahindra 575 DI XP Plus",
    image: "https://www.mahindratractor.com/sites/default/files/2024-07/575-DI-XP-PLUS-Desktop_1_1.webp",
    lat: 18.1610,
    lng: 74.5920,
    address: "Malegaon Road, Baramati",
    hp: 47,
    suitableLand: "2–15 acres",
    bestFor: "Ploughing, tilling & general-purpose work",
    bestCrop: "Wheat, Cotton",
    fuelType: "Diesel",
    fuelEfficiency: "3.8 L/hr",
    transmission: "8F + 2R, Sliding Mesh",
    pricePerHour: 450,
    pricePerDay: 2800,
    rating: 4.6,
    availability: "Available",
    description: "The most trusted workhorse for small and mid-size farms — reliable pulling power at a fair price.",
    performance: { power: 88, fuelEfficiency: 80, loadCapacity: 85, comfort: 78 },
    maintenanceCost: "Low"
  },
  {
    id: 2,
    name: "Swaraj 744 FE",
    image: "https://www.swarajtractors.com/sites/default/files/images/swaraj_744FE_615x473px_191023.png",
    lat: 18.1390,
    lng: 74.5700,
    address: "Katewadi, Baramati",
    hp: 48,
    suitableLand: "3–18 acres",
    bestFor: "Rotavator work & haulage",
    bestCrop: "Sugarcane, Maize",
    fuelType: "Diesel",
    fuelEfficiency: "3.6 L/hr",
    transmission: "8F + 2R, Constant Mesh",
    pricePerHour: 470,
    pricePerDay: 2950,
    rating: 4.5,
    availability: "Available",
    description: "Strong torque at low RPM makes this a favourite for rotavator and trolley haulage jobs.",
    performance: { power: 86, fuelEfficiency: 78, loadCapacity: 88, comfort: 74 },
    maintenanceCost: "Low"
  },
  {
    id: 3,
    name: "John Deere 5050D",
    image: "https://www.deere.co.in/assets/images/region-1/products/tractors/d-series-tractors/john_deere_tractor_5050D_large_a7341c4a17e854d5b4a1c9aeae3b3ab8c367b9ef.png",
    lat: 18.1700,
    lng: 74.6100,
    address: "Wadgaon Nimbalkar, Baramati",
    hp: 50,
    suitableLand: "5–25 acres",
    bestFor: "Heavy tillage & implements",
    bestCrop: "Cotton, Soybean",
    fuelType: "Diesel (CRDe)",
    fuelEfficiency: "4.1 L/hr",
    transmission: "8F + 2R, Collar Shift",
    pricePerHour: 590,
    pricePerDay: 3600,
    rating: 4.8,
    availability: "Limited",
    description: "Premium build quality and smoother ride — best suited for larger holdings and heavier implements.",
    performance: { power: 92, fuelEfficiency: 82, loadCapacity: 90, comfort: 88 },
    maintenanceCost: "Medium"
  },
  {
    id: 4,
    name: "Sonalika DI 745 III",
    image: "https://www.sonalika.com/media/product-thumbnail/di-745-iii-ff-1-1682749407.webp",
    lat: 18.1200,
    lng: 74.5500,
    address: "Jalochi, Baramati",
    hp: 50,
    suitableLand: "3–20 acres",
    bestFor: "Ploughing & threshing",
    bestCrop: "Wheat, Paddy",
    fuelType: "Diesel",
    fuelEfficiency: "3.9 L/hr",
    transmission: "8F + 2R, Sliding Mesh",
    pricePerHour: 460,
    pricePerDay: 2900,
    rating: 4.4,
    availability: "Available",
    description: "Fuel-efficient and easy to maintain — a dependable everyday choice for mixed cropping.",
    performance: { power: 84, fuelEfficiency: 83, loadCapacity: 82, comfort: 76 },
    maintenanceCost: "Low"
  },
  {
    id: 5,
    name: "New Holland 3630 TX Plus",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1731586332.webp?width=538&height=320",
    lat: 18.1800,
    lng: 74.5400,
    address: "Shirsuphal, Baramati",
    hp: 55,
    suitableLand: "6–30 acres",
    bestFor: "Heavy-duty haulage & implements",
    bestCrop: "Sugarcane, Cotton",
    fuelType: "Diesel",
    fuelEfficiency: "4.3 L/hr",
    transmission: "8F + 2R, Sliding Mesh",
    pricePerHour: 610,
    pricePerDay: 3750,
    rating: 4.7,
    availability: "Available",
    description: "Higher HP and load capacity built for bigger farms and demanding, multi-implement days.",
    performance: { power: 94, fuelEfficiency: 76, loadCapacity: 93, comfort: 85 },
    maintenanceCost: "Medium"
  },
  {
    id: 6,
    name: "Eicher 380",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1731731139.webp?width=538&height=320",
    lat: 18.1050,
    lng: 74.6000,
    address: "Nira Road, Baramati",
    hp: 39,
    suitableLand: "1–8 acres",
    bestFor: "Light tillage & small plots",
    bestCrop: "Vegetables, Pulses",
    fuelType: "Diesel",
    fuelEfficiency: "3.1 L/hr",
    transmission: "8F + 2R, Sliding Mesh",
    pricePerHour: 340,
    pricePerDay: 2100,
    rating: 4.3,
    availability: "Available",
    description: "Compact, nimble and cheap to run — ideal for small landholders and tight field corners.",
    performance: { power: 74, fuelEfficiency: 85, loadCapacity: 70, comfort: 70 },
    maintenanceCost: "Low"
  },
];