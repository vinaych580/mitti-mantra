/* =============================================================================
   generate_tractors.js — MittiMantra Tractor Pool Generator
   -----------------------------------------------------------------------------
   Generates ~600+ tractor rental listings spread across all major Indian states
   and districts. Output: Data/tractors.js (window.TRACTORS_DATA)

   Run with:  node frontend/Data/generate_tractors.js
   ============================================================================= */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Seeded RNG (Mulberry32) ────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// ── Deterministic 10-digit Indian mobile number (starts 6-9) ──────────────────
function genPhone(rng) {
  const first = 6 + Math.floor(rng() * 4); // 6,7,8,9
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(rng() * 10);
  return `${first}${rest.slice(0, 4)} ${rest.slice(4)}`;
}

// ── District data: [districtName, lat, lng] ────────────────────────────────────
// Covers ~200 major agricultural districts across India
const DISTRICT_DATA = {
  "Andhra Pradesh": [
    ["Kurnool", 15.8281, 78.0373], ["Guntur", 16.3067, 80.4365], ["Krishna", 16.5062, 80.6480],
    ["East Godavari", 17.3850, 82.0800], ["West Godavari", 16.9174, 81.3480],
    ["Nellore", 14.4426, 79.9865], ["Prakasam", 15.3390, 79.6200], ["Anantapur", 14.6819, 77.6006],
    ["Vizianagaram", 18.1066, 83.3956], ["Srikakulam", 18.2969, 83.8956],
  ],
  "Assam": [
    ["Kamrup", 26.1445, 91.7362], ["Sonitpur", 26.6333, 92.8000], ["Nagaon", 26.3469, 92.6841],
    ["Goalpara", 26.1697, 90.6253], ["Dhubri", 26.0217, 89.9716],
  ],
  "Bihar": [
    ["Patna", 25.5941, 85.1376], ["Gaya", 24.7914, 85.0002], ["Muzaffarpur", 26.1209, 85.3647],
    ["Bhagalpur", 25.2425, 86.9842], ["Darbhanga", 26.1542, 85.8918],
    ["Samastipur", 25.8617, 85.7820], ["Begusarai", 25.4182, 86.1272],
    ["Champaran", 26.8000, 84.9000], ["Nalanda", 25.1360, 85.4454],
  ],
  "Chhattisgarh": [
    ["Raipur", 21.2514, 81.6296], ["Bilaspur", 22.0797, 82.1409], ["Durg", 21.1905, 81.2849],
    ["Rajnandgaon", 21.0976, 81.0340], ["Raigarh", 21.8974, 83.3960],
    ["Korba", 22.3595, 82.7501], ["Bastar", 19.1174, 81.9542],
  ],
  "Gujarat": [
    ["Ahmedabad", 23.0225, 72.5714], ["Surat", 21.1702, 72.8311], ["Rajkot", 22.3039, 70.8022],
    ["Vadodara", 22.3072, 73.1812], ["Mehsana", 23.5880, 72.3693],
    ["Anand", 22.5645, 72.9289], ["Kheda", 22.7500, 72.6833], ["Sabarkantha", 23.4340, 73.0170],
    ["Banaskantha", 24.1739, 72.4337], ["Junagadh", 21.5222, 70.4579],
    ["Amreli", 21.6031, 71.2217], ["Bharuch", 21.7051, 72.9959],
    ["Surendranagar", 22.7271, 71.6501], ["Bhavnagar", 21.7645, 72.1519],
  ],
  "Haryana": [
    ["Karnal", 29.6857, 76.9905], ["Hisar", 29.1492, 75.7217], ["Rohtak", 28.8955, 76.6066],
    ["Ambala", 30.3782, 76.7767], ["Sonipat", 28.9931, 77.0151],
    ["Sirsa", 29.5348, 75.0245], ["Fatehabad", 29.5150, 75.4556],
    ["Jind", 29.3195, 76.3146], ["Bhiwani", 28.7930, 76.1390],
    ["Kaithal", 29.8015, 76.3995], ["Kurukshetra", 29.9695, 76.8783],
  ],
  "Himachal Pradesh": [
    ["Kangra", 32.0998, 76.2691], ["Mandi", 31.7089, 76.9320], ["Shimla", 31.1048, 77.1734],
    ["Kullu", 31.9579, 77.1095], ["Solan", 30.9045, 77.0967],
  ],
  "Jharkhand": [
    ["Ranchi", 23.3441, 85.3096], ["Dhanbad", 23.7957, 86.4304], ["Bokaro", 23.6693, 86.1511],
    ["Hazaribagh", 23.9924, 85.3637], ["Dumka", 24.2673, 87.2494],
    ["Giridih", 24.1882, 86.3036], ["Jamshedpur", 22.8046, 86.2029],
  ],
  "Karnataka": [
    ["Belagavi", 15.8497, 74.4977], ["Kalaburagi", 17.3297, 76.8343], ["Tumakuru", 13.3379, 77.1173],
    ["Mysuru", 12.2958, 76.6394], ["Mandya", 12.5218, 76.8951],
    ["Hassan", 13.0072, 76.0962], ["Dharwad", 15.4589, 75.0078],
    ["Vijayapura", 16.8302, 75.7100], ["Haveri", 14.7936, 75.4040],
    ["Raichur", 16.2120, 77.3566], ["Davanagere", 14.4644, 75.9218],
    ["Shivamogga", 13.9299, 75.5681], ["Chitradurga", 14.2251, 76.4015],
    ["Koppal", 15.3508, 76.1547], ["Gadag", 15.4313, 75.6317],
  ],
  "Kerala": [
    ["Thrissur", 10.5276, 76.2144], ["Palakkad", 10.7867, 76.6548], ["Malappuram", 11.0510, 76.0711],
    ["Kozhikode", 11.2588, 75.7804], ["Wayanad", 11.6854, 76.1320],
    ["Idukki", 9.8497, 77.1695], ["Kollam", 8.8932, 76.6141],
  ],
  "Madhya Pradesh": [
    ["Indore", 22.7196, 75.8577], ["Bhopal", 23.2599, 77.4126], ["Jabalpur", 23.1815, 79.9864],
    ["Gwalior", 26.2183, 78.1828], ["Rewa", 24.5337, 81.3042],
    ["Sagar", 23.8388, 78.7378], ["Satna", 24.5874, 80.8322], ["Chhindwara", 22.0574, 78.9382],
    ["Vidisha", 23.5231, 77.8133], ["Sehore", 23.2032, 77.0844],
    ["Harda", 22.3420, 77.0920], ["Raisen", 23.3263, 77.7874],
    ["Hoshangabad", 22.7513, 77.7263], ["Narsinghpur", 22.9440, 79.1940],
    ["Khandwa", 21.8247, 76.3510], ["Dewas", 22.9622, 76.0508],
    ["Mandsaur", 24.0750, 75.0700], ["Ujjain", 23.1794, 75.7849],
    ["Damoh", 23.8350, 79.4420], ["Panna", 24.7180, 80.1830],
    ["Tikamgarh", 24.7440, 78.8320], ["Chhatarpur", 24.9170, 79.5860],
    ["Shivpuri", 25.4231, 77.6572], ["Guna", 24.6510, 77.3100],
  ],
  "Maharashtra": [
    ["Pune", 18.5204, 73.8567], ["Nashik", 19.9975, 73.7898], ["Aurangabad", 19.8762, 75.3433],
    ["Kolhapur", 16.7050, 74.2433], ["Ahmednagar", 19.0948, 74.7480],
    ["Solapur", 17.6599, 75.9064], ["Satara", 17.6805, 73.9918],
    ["Sangli", 16.8524, 74.5815], ["Amravati", 20.9374, 77.7796],
    ["Latur", 18.3956, 76.5600], ["Nanded", 19.1383, 77.3210],
    ["Osmanabad", 18.1769, 76.0428], ["Buldhana", 20.5292, 76.1826],
    ["Akola", 20.7096, 77.0024], ["Yavatmal", 20.3888, 78.1204],
    ["Wardha", 20.7453, 78.6022], ["Nagpur", 21.1458, 79.0882],
    ["Bhandara", 21.1679, 79.6517], ["Gondia", 21.4611, 80.1969],
    ["Chandrapur", 19.9615, 79.2961], ["Jalgaon", 21.0077, 75.5626],
    ["Dhule", 20.9042, 74.7749], ["Nandurbar", 21.3682, 74.2401],
    ["Raigad", 18.5130, 73.1100], ["Ratnagiri", 16.9902, 73.3120],
    ["Sindhudurg", 16.3490, 73.7570],
  ],
  "Manipur": [
    ["Imphal West", 24.8170, 93.9368], ["Thoubal", 24.6393, 93.9967], ["Bishnupur", 24.6266, 93.7764],
  ],
  "Meghalaya": [
    ["East Khasi Hills", 25.5788, 91.8831], ["Ri Bhoi", 25.7491, 91.9811],
  ],
  "Odisha": [
    ["Cuttack", 20.4625, 85.8828], ["Puri", 19.8135, 85.8312], ["Balasore", 21.4942, 86.9330],
    ["Berhampur", 19.3150, 84.7941], ["Sambalpur", 21.4669, 83.9812],
    ["Bargarh", 21.3320, 83.6200], ["Sundargarh", 22.1178, 84.0281],
    ["Kendrapara", 20.4991, 86.4199], ["Jagatsinghpur", 20.2543, 86.1688],
    ["Boudh", 20.8460, 84.3260], ["Koraput", 18.8121, 82.7154],
  ],
  "Punjab": [
    ["Ludhiana", 30.9010, 75.8573], ["Amritsar", 31.6340, 74.8723], ["Patiala", 30.3398, 76.3869],
    ["Jalandhar", 31.3260, 75.5762], ["Bathinda", 30.2110, 74.9455],
    ["Gurdaspur", 32.0389, 75.4063], ["Hoshiarpur", 31.5322, 75.9188],
    ["Moga", 30.8178, 75.1738], ["Fazilka", 30.3986, 74.0228],
    ["Fatehgarh Sahib", 30.6465, 76.3907], ["Sangrur", 30.2481, 75.8444],
    ["Barnala", 30.3778, 75.5430], ["Muktsar", 30.4776, 74.5198],
    ["Ferozepur", 30.9236, 74.6131], ["Tarn Taran", 31.4519, 74.9284],
    ["Nawanshahr", 31.1232, 76.1148],
  ],
  "Rajasthan": [
    ["Jaipur", 26.9124, 75.7873], ["Jodhpur", 26.2389, 73.0243], ["Udaipur", 24.5854, 73.7125],
    ["Kota", 25.2138, 75.8648], ["Ajmer", 26.4499, 74.6399],
    ["Bikaner", 28.0229, 73.3119], ["Alwar", 27.5530, 76.6346],
    ["Sikar", 27.6094, 75.1399], ["Tonk", 26.1671, 75.7881],
    ["Hanumangarh", 29.5833, 74.3330], ["Ganganagar", 29.9141, 73.8756],
    ["Churu", 28.2968, 74.9678], ["Jhunjhunu", 28.1317, 75.3982],
    ["Nagaur", 27.2027, 73.7342], ["Barmer", 25.7463, 71.3964],
    ["Jaisalmer", 26.9157, 70.9083], ["Pali", 25.7711, 73.3233],
    ["Jalor", 25.3473, 72.6131], ["Sirohi", 24.8853, 72.8617],
    ["Bhilwara", 25.3462, 74.6313], ["Chittorgarh", 24.8887, 74.6269],
  ],
  "Tamil Nadu": [
    ["Coimbatore", 11.0168, 76.9558], ["Madurai", 9.9252, 78.1198], ["Thanjavur", 10.7870, 79.1378],
    ["Salem", 11.6643, 78.1460], ["Tiruchirappalli", 10.7905, 78.7047],
    ["Vellore", 12.9165, 79.1325], ["Tirunelveli", 8.7139, 77.7567],
    ["Erode", 11.3410, 77.7172], ["Tiruppur", 11.1085, 77.3411],
    ["Dindigul", 10.3624, 77.9695], ["Nagapattinam", 10.7605, 79.8420],
    ["Virudhunagar", 9.5800, 77.9620], ["Sivaganga", 9.8420, 78.4800],
    ["Pudukkottai", 10.3797, 78.8200], ["Ramanathapuram", 9.3766, 78.8360],
    ["Thoothukudi", 8.7642, 78.1348],
  ],
  "Telangana": [
    ["Warangal", 17.9784, 79.5941], ["Nalgonda", 17.0575, 79.2673], ["Karimnagar", 18.4386, 79.1288],
    ["Nizamabad", 18.6725, 78.0941], ["Khammam", 17.2473, 80.1514],
    ["Mahabubnagar", 16.7448, 77.9864], ["Medak", 18.0440, 78.2620],
    ["Rangareddy", 17.4399, 78.4983], ["Adilabad", 19.6640, 78.5320],
    ["Suryapet", 17.1400, 79.6200],
  ],
  "Uttar Pradesh": [
    ["Lucknow", 26.8467, 80.9462], ["Kanpur", 26.4499, 80.3319], ["Prayagraj", 25.4358, 81.8463],
    ["Varanasi", 25.3176, 82.9739], ["Agra", 27.1767, 78.0081],
    ["Bareilly", 28.3640, 79.4150], ["Meerut", 28.9845, 77.7064],
    ["Aligarh", 27.8974, 78.0880], ["Gorakhpur", 26.7606, 83.3732],
    ["Moradabad", 28.8386, 78.7733], ["Muzaffarnagar", 29.4727, 77.7085],
    ["Mathura", 27.4924, 77.6737], ["Jhansi", 25.4484, 78.5685],
    ["Firozabad", 27.1530, 78.3950], ["Bulandshahr", 28.4069, 77.8498],
    ["Banda", 25.4800, 80.3350], ["Etawah", 26.7850, 79.0170],
    ["Mainpuri", 27.2360, 79.0170], ["Farrukhabad", 27.3900, 79.5820],
    ["Hathras", 27.5960, 78.0570], ["Kasganj", 27.8000, 78.6450],
    ["Fatehpur", 25.9290, 80.8210], ["Rae Bareli", 26.2240, 81.2350],
    ["Hardoi", 27.3960, 80.1270], ["Sitapur", 27.5620, 80.6840],
    ["Shahjahanpur", 27.8810, 79.9050], ["Lakhimpur", 27.9480, 80.7810],
  ],
  "Uttarakhand": [
    ["Dehradun", 30.3165, 78.0322], ["Haridwar", 29.9457, 78.1642], ["Udham Singh Nagar", 29.0000, 79.5500],
    ["Nainital", 29.3803, 79.4636], ["Tehri", 30.3782, 78.4805],
  ],
  "West Bengal": [
    ["Burdwan", 23.2324, 87.8630], ["Murshidabad", 24.1750, 88.2804], ["Nadia", 23.4053, 88.5553],
    ["Bankura", 23.2300, 87.0700], ["Birbhum", 23.9000, 87.5350],
    ["Hooghly", 22.8991, 88.3867], ["Jalpaiguri", 26.5213, 88.7200],
    ["Koch Bihar", 26.3250, 89.4400], ["Malda", 25.0083, 88.1330],
    ["Midnapore", 22.4240, 87.3190], ["Purulia", 23.3304, 86.3648],
    ["Howrah", 22.5958, 88.2636], ["24 Parganas North", 22.8600, 88.5400],
  ],
};

// ── Real Indian Tractor Brands & Models ───────────────────────────────────────
const TRACTOR_MODELS = [
  {
    name: "Mahindra 575 DI XP Plus",
    image: "https://www.mahindratractor.com/sites/default/files/2024-07/575-DI-XP-PLUS-Desktop_1_1.webp",
    hp: 47, baseHourly: 450, baseDaily: 2800,
    suitableLand: "2–15 acres", bestFor: "Ploughing, tilling & general-purpose work",
    fuelType: "Diesel", fuelEfficiency: "3.8 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 88, fuelEfficiency: 80, loadCapacity: 85, comfort: 78 },
    maintenanceCost: "Low",
    description: "The most trusted workhorse for small and mid-size farms — reliable pulling power at a fair price."
  },
  {
    name: "Swaraj 744 FE",
    image: "https://www.swarajtractors.com/sites/default/files/images/swaraj_744FE_615x473px_191023.png",
    hp: 48, baseHourly: 470, baseDaily: 2950,
    suitableLand: "3–18 acres", bestFor: "Rotavator work & haulage",
    fuelType: "Diesel", fuelEfficiency: "3.6 L/hr", transmission: "8F + 2R, Constant Mesh",
    performance: { power: 86, fuelEfficiency: 78, loadCapacity: 88, comfort: 74 },
    maintenanceCost: "Low",
    description: "Strong torque at low RPM makes this a favourite for rotavator and trolley haulage jobs."
  },
  {
    name: "John Deere 5050D",
    image: "https://www.deere.co.in/assets/images/region-1/products/tractors/d-series-tractors/john_deere_tractor_5050D_large_a7341c4a17e854d5b4a1c9aeae3b3ab8c367b9ef.png",
    hp: 50, baseHourly: 590, baseDaily: 3600,
    suitableLand: "5–25 acres", bestFor: "Heavy tillage & implements",
    fuelType: "Diesel (CRDe)", fuelEfficiency: "4.1 L/hr", transmission: "8F + 2R, Collar Shift",
    performance: { power: 92, fuelEfficiency: 82, loadCapacity: 90, comfort: 88 },
    maintenanceCost: "Medium",
    description: "Premium build quality and smoother ride — best suited for larger holdings and heavier implements."
  },
  {
    name: "Sonalika DI 745 III",
    image: "https://www.sonalika.com/media/product-thumbnail/di-745-iii-ff-1-1682749407.webp",
    hp: 50, baseHourly: 460, baseDaily: 2900,
    suitableLand: "3–20 acres", bestFor: "Ploughing & threshing",
    fuelType: "Diesel", fuelEfficiency: "3.9 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 84, fuelEfficiency: 83, loadCapacity: 82, comfort: 76 },
    maintenanceCost: "Low",
    description: "Fuel-efficient and easy to maintain — a dependable everyday choice for mixed cropping."
  },
  {
    name: "New Holland 3630 TX Plus",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1731586332.webp?width=538&height=320",
    hp: 55, baseHourly: 610, baseDaily: 3750,
    suitableLand: "6–30 acres", bestFor: "Heavy-duty haulage & implements",
    fuelType: "Diesel", fuelEfficiency: "4.3 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 94, fuelEfficiency: 76, loadCapacity: 93, comfort: 85 },
    maintenanceCost: "Medium",
    description: "Higher HP and load capacity built for bigger farms and demanding, multi-implement days."
  },
  {
    name: "Eicher 380",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1731731139.webp?width=538&height=320",
    hp: 39, baseHourly: 340, baseDaily: 2100,
    suitableLand: "1–8 acres", bestFor: "Light tillage & small plots",
    fuelType: "Diesel", fuelEfficiency: "3.1 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 74, fuelEfficiency: 85, loadCapacity: 70, comfort: 70 },
    maintenanceCost: "Low",
    description: "Compact, nimble and cheap to run — ideal for small landholders and tight field corners."
  },
  {
    name: "Massey Ferguson 241 DI",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1731603096.webp?width=538&height=320",
    hp: 42, baseHourly: 400, baseDaily: 2500,
    suitableLand: "2–14 acres", bestFor: "Ploughing & general tillage",
    fuelType: "Diesel", fuelEfficiency: "3.5 L/hr", transmission: "8F + 2R, Dual Clutch",
    performance: { power: 80, fuelEfficiency: 82, loadCapacity: 78, comfort: 74 },
    maintenanceCost: "Low",
    description: "India's favourite dual-clutch workhorse — simple, sturdy and cheap to keep running."
  },
  {
    name: "Farmtrac 50 Powermaxx",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/images/oldTractor/50-powermaxx-216062-1763354782-0.webp?width=538&height=320",
    hp: 50, baseHourly: 520, baseDaily: 3200,
    suitableLand: "4–22 acres", bestFor: "Rotavator & heavy haulage",
    fuelType: "Diesel (CRDe)", fuelEfficiency: "4.0 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 90, fuelEfficiency: 79, loadCapacity: 87, comfort: 82 },
    maintenanceCost: "Medium",
    description: "High torque back-up and a roomy cabin — built for long days of heavy-duty rotavator work."
  },
  {
    name: "Powertrac Euro 50",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/tractor-images/tractor-image-0-1740036829.webp?width=538&height=320",
    hp: 50, baseHourly: 480, baseDaily: 2950,
    suitableLand: "4–20 acres", bestFor: "Ploughing, tilling & haulage",
    fuelType: "Diesel", fuelEfficiency: "3.9 L/hr", transmission: "8F + 2R, Side-Shift",
    performance: { power: 87, fuelEfficiency: 80, loadCapacity: 86, comfort: 76 },
    maintenanceCost: "Low",
    description: "A dependable Escorts-built powerhouse with strong pulling capacity for demanding implements."
  },
  {
    name: "TAFE 4615",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/upload/tafe-4615-1766750032.webp?width=538&height=320",
    hp: 47, baseHourly: 440, baseDaily: 2750,
    suitableLand: "3–18 acres", bestFor: "Everyday tillage & trolley haulage",
    fuelType: "Diesel", fuelEfficiency: "3.7 L/hr", transmission: "10F + 2R, Sliding Mesh",
    performance: { power: 83, fuelEfficiency: 81, loadCapacity: 83, comfort: 75 },
    maintenanceCost: "Low",
    description: "TAFE's classic-series reliability — a steady performer trusted across generations of farmers."
  },
  {
    name: "Kubota MU4501 2WD",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/images/oldTractor/mu4501-2wd-234346-1784208632-0.webp?width=538&height=320",
    hp: 45, baseHourly: 470, baseDaily: 2900,
    suitableLand: "3–16 acres", bestFor: "Precision tillage & orchard work",
    fuelType: "Diesel", fuelEfficiency: "3.4 L/hr", transmission: "8F + 4R, Synchro Shuttle",
    performance: { power: 82, fuelEfficiency: 88, loadCapacity: 80, comfort: 84 },
    maintenanceCost: "Low",
    description: "Japanese engineering that sips less fuel per acre — smooth, quiet and low on upkeep."
  },
  {
    name: "VST Shakti 9054 DI Viraaj",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/upload/vst-9054-di-viraaj-1726905167.webp?width=538&height=320",
    hp: 50, baseHourly: 460, baseDaily: 2850,
    suitableLand: "3–20 acres", bestFor: "Ploughing & cultivator work",
    fuelType: "Diesel", fuelEfficiency: "3.8 L/hr", transmission: "8F + 2R, Constant Mesh",
    performance: { power: 86, fuelEfficiency: 79, loadCapacity: 84, comfort: 73 },
    maintenanceCost: "Low",
    description: "A value-for-money mid-range tractor with strong PTO output for cultivator and thresher jobs."
  },
  {
    name: "New Holland 3630 TX Super",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/images/oldTractor/3630-tx-super-206710-1772883438-0.webp?width=538&height=320",
    hp: 50, baseHourly: 540, baseDaily: 3300,
    suitableLand: "5–24 acres", bestFor: "Heavy tillage & multi-implement work",
    fuelType: "Diesel", fuelEfficiency: "4.0 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 89, fuelEfficiency: 77, loadCapacity: 89, comfort: 83 },
    maintenanceCost: "Medium",
    description: "The Super variant adds extra grunt over the base 3630 — a favourite for bigger, tougher plots."
  },
  {
    name: "Swaraj 855 FE",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/images/oldTractor/855-fe-227924-1785920764-0.webp?width=538&height=320",
    hp: 49, baseHourly: 500, baseDaily: 3050,
    suitableLand: "4–20 acres", bestFor: "Rotavator & trailer haulage",
    fuelType: "Diesel", fuelEfficiency: "3.9 L/hr", transmission: "8F + 2R, Constant Mesh",
    performance: { power: 88, fuelEfficiency: 78, loadCapacity: 87, comfort: 77 },
    maintenanceCost: "Low",
    description: "Swaraj's heavier-duty FE sibling — extra muscle for rotavator work and full trolley loads."
  },
  {
    name: "Sonalika Tiger DI 50",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/images/oldTractor/tiger-di-50-232375-1783754912-0.webp?width=538&height=320",
    hp: 50, baseHourly: 480, baseDaily: 2950,
    suitableLand: "3–20 acres", bestFor: "Ploughing & threshing",
    fuelType: "Diesel", fuelEfficiency: "3.9 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 85, fuelEfficiency: 82, loadCapacity: 83, comfort: 77 },
    maintenanceCost: "Low",
    description: "The bigger Tiger sibling to the DI 745 III — extra power for larger plots without a big price jump."
  },
  {
    name: "Force Balwan 450",
    image: "https://images.tractorgyan.com/uploads/3109/614c34c6670b0_force-BALWAN-450-tractorgyan.jpg",
    hp: 45, baseHourly: 420, baseDaily: 2600,
    suitableLand: "2–15 acres", bestFor: "General-purpose farm work",
    fuelType: "Diesel", fuelEfficiency: "3.6 L/hr", transmission: "8F + 4R, Dual Clutch",
    performance: { power: 79, fuelEfficiency: 80, loadCapacity: 77, comfort: 72 },
    maintenanceCost: "Low",
    description: "A no-frills, budget-friendly Force Motors tractor built for everyday mixed farm chores."
  },
  {
    name: "Standard DI 355",
    image: "https://images.tractorgyan.com/uploads/3229/61518c3c2b254_standard-DI-355-tractorgyan.jpg",
    hp: 55, baseHourly: 560, baseDaily: 3400,
    suitableLand: "5–25 acres", bestFor: "Heavy tillage & haulage",
    fuelType: "Diesel", fuelEfficiency: "4.2 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 90, fuelEfficiency: 75, loadCapacity: 90, comfort: 79 },
    maintenanceCost: "Medium",
    description: "One of the most fuel-efficient tractors in its 55 HP class — solid power for bigger holdings."
  },
  {
    name: "Solis 4515 E",
    image: "https://assets.tractorjunction.com/tractor-junction/assets/images/upload/solis-4515-e-1696501694.jpg",
    hp: 48, baseHourly: 450, baseDaily: 2800,
    suitableLand: "3–18 acres", bestFor: "Ploughing & rotavator work",
    fuelType: "Diesel", fuelEfficiency: "3.7 L/hr", transmission: "8F + 2R, Sliding Mesh",
    performance: { power: 84, fuelEfficiency: 81, loadCapacity: 82, comfort: 76 },
    maintenanceCost: "Low",
    description: "An export-grade International Tractors build — dependable power at a competitive price."
  }
];

const OPERATOR_NAMES = [
  "Ram Singh", "Suresh Kumar", "Ajit Prasad", "Dilip Yadav", "Ravi Shankar",
  "Mohan Lal", "Vikram Singh", "Anand Kumar", "Prakash Reddy", "Surinder Pal",
  "Gurpreet Singh", "Harinder Kaur", "Santosh Patil", "Balu Shinde", "Kishor Pawar",
  "Prabhu Deva", "Murugan K", "Selvam R", "Nataraj P", "Govindan V",
  "Abdul Hameed", "Mohammed Rafi", "Zahir Khan", "Imtiaz Ahmed", "Feroz Sheikh",
  "Ramesh Babu", "Sridhar Rao", "Venkat Rao", "Krishna Murthy", "Nagaraju T",
  "Hemant Sahu", "Rajesh Patel", "Dinesh Bhai", "Bhavesh Desai", "Kiran Patel",
  "Subhash Rana", "Bhim Chauhan", "Daulat Ram", "Raghuveer Singh", "Balram Yadav",
  "Nitin Patil", "Mahesh Jadhav", "Ganesh More", "Arun Deshmukh", "Vilas Gaikwad",
];

const AVAILABILITY_OPTIONS = ["Available", "Available", "Available", "Limited", "Booked"];

function getAddressHint(district, state) {
  const hints = [
    `Near Mandi, ${district}`,
    `${district} Agricultural Market`,
    `${district} Gram Panchayat Hub`,
    `Kisan Bhawan, ${district}`,
    `${district} Highway, ${state}`,
    `FPO Centre, ${district}`,
    `Near ${district} Tehsil`,
    `${district} Farm Services Centre`,
  ];
  return hints[Math.abs(district.charCodeAt(0) * 7 + state.charCodeAt(0) * 3) % hints.length];
}

// ── Generate Tractors ─────────────────────────────────────────────────────────
const tractors = [];
let id = 1;

for (const [state, districts] of Object.entries(DISTRICT_DATA)) {
  for (const [district, lat, lng] of districts) {
    // 2 tractors per district
    for (let i = 0; i < 2; i++) {
      const seed = id * 6271 + state.charCodeAt(0) * 43 + district.charCodeAt(0) * 17 + i * 89;
      const rng = seededRng(seed);

      const model = pick(TRACTOR_MODELS, rng);
      const operator = pick(OPERATOR_NAMES, rng);
      const operatorPhone = genPhone(rng);
      const availability = AVAILABILITY_OPTIONS[Math.floor(rng() * AVAILABILITY_OPTIONS.length)];

      // Slight coordinate offset so two tractors in same district aren't identical
      const offsetLat = +(lat + (i - 0.5) * 0.02).toFixed(4);
      const offsetLng = +(lng + (i - 0.5) * 0.02).toFixed(4);

      // Price slightly varies by state (cost-of-living factor)
      const priceMultiplier = state === "Maharashtra" || state === "Punjab" || state === "Gujarat" ? 1.1 :
                              state === "Bihar" || state === "Odisha" || state === "Jharkhand" ? 0.9 :
                              1.0;
      const hourlyPrice = Math.round(model.baseHourly * priceMultiplier / 10) * 10;
      const dailyPrice  = Math.round(model.baseDaily  * priceMultiplier / 50) * 50;

      const rating = +(4.0 + rng() * 0.99).toFixed(1);

      tractors.push({
        id,
        name: model.name,
        image: model.image,
        lat: offsetLat,
        lng: offsetLng,
        address: getAddressHint(district, state),
        district,
        state,
        hp: model.hp,
        suitableLand: model.suitableLand,
        bestFor: model.bestFor,
        bestCrop: guessBestCrop(state, model.name),
        fuelType: model.fuelType,
        fuelEfficiency: model.fuelEfficiency,
        transmission: model.transmission,
        pricePerHour: hourlyPrice,
        pricePerDay: dailyPrice,
        rating,
        availability,
        description: model.description,
        performance: model.performance,
        maintenanceCost: model.maintenanceCost,
        operatorName: operator,
        operatorPhone,
      });

      id++;
    }
  }
}

function guessBestCrop(state, modelName) {
  const cropMap = {
    "Punjab": "Wheat, Paddy", "Haryana": "Wheat, Paddy", "Uttar Pradesh": "Wheat, Sugarcane",
    "Bihar": "Paddy, Maize", "Madhya Pradesh": "Soybean, Wheat", "Rajasthan": "Bajra, Mustard",
    "Maharashtra": "Cotton, Sugarcane", "Gujarat": "Groundnut, Cotton", "Karnataka": "Paddy, Maize",
    "Tamil Nadu": "Paddy, Vegetables", "Telangana": "Paddy, Cotton", "Andhra Pradesh": "Paddy, Groundnut",
    "Odisha": "Paddy, Jute", "West Bengal": "Paddy, Potato", "Assam": "Paddy, Tea",
    "Chhattisgarh": "Paddy, Maize", "Jharkhand": "Paddy, Maize", "Uttarakhand": "Wheat, Potato",
    "Himachal Pradesh": "Apple, Potato", "Kerala": "Coconut, Paddy", "Manipur": "Paddy, Vegetables",
    "Meghalaya": "Paddy, Potato",
  };
  return cropMap[state] || "Wheat, Cotton";
}

// ── Write output ───────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'tractors.js');

const lines = tractors.map(t => `  {
    id: ${t.id},
    name: ${JSON.stringify(t.name)},
    image: ${JSON.stringify(t.image)},
    lat: ${t.lat}, lng: ${t.lng},
    address: ${JSON.stringify(t.address)},
    district: ${JSON.stringify(t.district)},
    state: ${JSON.stringify(t.state)},
    hp: ${t.hp},
    suitableLand: ${JSON.stringify(t.suitableLand)},
    bestFor: ${JSON.stringify(t.bestFor)},
    bestCrop: ${JSON.stringify(t.bestCrop)},
    fuelType: ${JSON.stringify(t.fuelType)},
    fuelEfficiency: ${JSON.stringify(t.fuelEfficiency)},
    transmission: ${JSON.stringify(t.transmission)},
    pricePerHour: ${t.pricePerHour},
    pricePerDay: ${t.pricePerDay},
    rating: ${t.rating},
    availability: ${JSON.stringify(t.availability)},
    description: ${JSON.stringify(t.description)},
    performance: { power: ${t.performance.power}, fuelEfficiency: ${t.performance.fuelEfficiency}, loadCapacity: ${t.performance.loadCapacity}, comfort: ${t.performance.comfort} },
    maintenanceCost: ${JSON.stringify(t.maintenanceCost)},
    operatorName: ${JSON.stringify(t.operatorName)},
    operatorPhone: ${JSON.stringify(t.operatorPhone)}
  }`);

const output = `/* =========================================================================
   Tractor rental data — MittiMantra "Book a Tractor"
   -------------------------------------------------------------------------
   AUTO-GENERATED by generate_tractors.js — DO NOT EDIT MANUALLY.
   ${tractors.length} tractors • ${Object.keys(DISTRICT_DATA).length} states • Every major Indian district.
   ========================================================================= */

window.TRACTORS_DATA = [
${lines.join(',\n')}
];
`;

fs.writeFileSync(outPath, output, 'utf8');
console.log(`✅ Generated ${tractors.length} tractors across ${Object.keys(DISTRICT_DATA).length} states → ${outPath}`);
