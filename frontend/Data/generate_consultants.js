/**
 * generate_consultants.js
 * Run: node frontend/Data/generate_consultants.js
 * Outputs: frontend/Data/consultants.js
 *
 * Generates one verified agricultural expert per Indian district.
 * Real GPS coordinates for every district headquarters.
 */

const fs = require("fs");
const path = require("path");
const { renderDataFile } = require("./encode-columns");

// ── Name pools (region-aware) ────────────────────────────────────────────────
const NORTH_FIRST = ["Rajesh","Pankaj","Suresh","Ramesh","Vikram","Amit","Mahendra","Deepak","Ritu","Priya","Asha","Kavita","Neeta","Sangeeta","Ravi","Ajay","Vijay","Anuj","Rohit","Sanjay","Rakesh","Dinesh","Manoj","Anil","Sunita","Savita","Geeta","Rekha","Usha","Meena","Vinod","Ashok","Bhupesh","Chandrashekhar","Devendra","Hemant","Kamlesh","Naresh","Pramod","Shyam"];
const NORTH_LAST = ["Sharma","Gupta","Singh","Yadav","Tiwari","Mishra","Verma","Pandey","Srivastava","Dubey","Chaurasia","Saxena","Agarwal","Jain","Kumar","Patel","Shah","Chauhan","Rana","Thakur","Rawat","Negi","Bisht","Joshi","Upadhyay","Tripathi","Shukla","Malhotra","Khanna"];
const SOUTH_FIRST = ["Suresh","Ramesh","Prakash","Anand","Karthik","Venkat","Balu","Ravi","Mani","Siva","Arjun","Senthil","Murugan","Selvam","Praveen","Arulmozhi","Durai","Ganesan","Kannan","Kumaran","Lakshmi","Meenakshi","Priya","Sudha","Kavitha","Thenmozhi","Bhavani","Padma","Saranya","Deepa","Suresh","Mohan","Kalyan","Srinivas","Venkatesan","Rajasekhar","Narasimha","Padmanabhan","Thyagarajan","Balaji"];
const SOUTH_LAST = ["Reddy","Naidu","Rao","Sharma","Kumar","Pillai","Nair","Menon","Varma","Iyer","Iyengar","Krishnamurthy","Subramaniam","Venkataraman","Balasubramaniam","Raghunathan","Srinivasan","Natarajan","Ranganathan","Viswanathan","Gowda","Hegde","Shetty","Kamath","Bhat","Naik","Swain","Pattnaik","Mohapatra","Parida"];
const WEST_FIRST = ["Kalpesh","Jayesh","Dhruv","Nilesh","Amol","Vijay","Raju","Ganesh","Ramji","Suresh","Hetal","Rima","Neha","Bhavna","Smita","Meenal","Vrushali","Madhuri","Rupali","Sonali","Deepak","Mahesh","Nitin","Sanjay","Girish","Mangesh","Santosh","Vishwas","Prasad","Shriram"];
const WEST_LAST = ["Patel","Shah","Desai","Joshi","Trivedi","Mehta","Bhatt","Parikh","Modi","Dave","Patil","Deshmukh","Kulkarni","Pawar","Shinde","Jadhav","More","Kadam","Bhosale","Wagh","Rane","Sawant","Gaikwad","Mhaske","Salunke","Talekar"];
const EAST_FIRST = ["Bimal","Tapas","Soumya","Suparna","Pradip","Subhash","Arun","Nilotpal","Rituraj","Binay","Madhuri","Puja","Rani","Mita","Rekha","Sumita","Shyamali","Rinku","Preeti","Sudeshna","Kalyan","Sudipta","Biswajit","Partha","Debabrata","Sajal","Biplab","Mrinal","Anup","Gautam"];
const EAST_LAST = ["Ghosh","Das","Dey","Roy","Chakraborty","Banerjee","Mukherjee","Sen","Bose","Mitra","Swain","Pattnaik","Mohapatra","Sahoo","Pradhan","Mishra","Sahu","Nayak","Barik","Behera","Bora","Baruah","Deka","Kalita","Sharma","Hazarika","Gogoi","Das","Choudhury","Talukdar"];
const PUNJAB_FIRST = ["Gurpreet","Manpreet","Harbhajan","Jaswinder","Kulwinder","Balwinder","Daljit","Paramjit","Sukhwinder","Amarjit","Harpreet","Navdeep","Satinder","Ranjit","Karamjit","Gurdip","Lakhwinder","Prabhjot","Simranjit","Tejinder"];
const PUNJAB_LAST = ["Singh","Kaur","Gill","Brar","Sidhu","Sandhu","Grewal","Dhillon","Cheema","Bajwa","Sekhon","Johal","Randhawa","Sohal","Aulakh","Mann","Khanna","Kapoor","Arora","Bhatia"];
const TRIBAL_FIRST = ["Govind","Ramesh","Suresh","Birsa","Mangal","Budhram","Sanna","Karma","Dura","Hemla","Savita","Phulo","Murali","Jitendra","Rajendra","Chandru","Bhanu","Hari","Shiv","Durga"];
const TRIBAL_LAST = ["Sahu","Yadav","Kumar","Baiga","Gond","Oraon","Munda","Soren","Hembram","Murmu","Kisku","Tudu","Marandi","Hansda","Besra","Majhi","Tirkey","Lakra","Kujur","Minz"];

// ── Qualification pools ──────────────────────────────────────────────────────
const QUALIFICATIONS = [
  "Ph.D. Agronomy","Ph.D. Soil Science","Ph.D. Plant Pathology","Ph.D. Entomology",
  "Ph.D. Agricultural Economics","Ph.D. Horticulture","Ph.D. Agricultural Meteorology",
  "Ph.D. Arid Zone Agriculture","Ph.D. Organic Farming",
  "M.Sc. Agronomy","M.Sc. Plant Pathology","M.Sc. Horticulture","M.Sc. Soil Science",
  "M.Sc. Agricultural Extension","M.Sc. Agricultural Economics","M.Sc. Entomology",
  "M.Sc. Water Resources","M.Sc. Plant Protection","M.Sc. Agriculture",
  "B.Tech Agricultural Engineering","B.Sc. Agriculture","M.Tech Water Resources Engineering"
];

// ── Specialization list ──────────────────────────────────────────────────────
const SPECIALIZATIONS = [
  "Low crop yield","Soil testing","Soil does not retain water","Pest attack",
  "Leaf diseases","Fertilizer recommendation","Irrigation planning","Organic farming",
  "Government schemes","Weather-related issues","Crop selection","Post-harvest storage",
  "Machinery guidance","Market price guidance"
];

// ── Availability ─────────────────────────────────────────────────────────────
const AVAILABILITY = ["Online","Available Tomorrow","Offline"];
const RESP_TIMES = ["within 15 minutes","within 20 minutes","within 30 minutes","within 1 hour","within 2 hours","within 3 hours","within 4 hours","within 5 hours"];

// ── Language pools by region ─────────────────────────────────────────────────
const LANG_MAP = {
  "Andhra Pradesh": ["Telugu","English"],
  "Arunachal Pradesh": ["Hindi","English","Nyishi"],
  "Assam": ["Assamese","Bengali","Hindi","English"],
  "Bihar": ["Hindi","Bhojpuri","Maithili"],
  "Chhattisgarh": ["Hindi","Chhattisgarhi"],
  "Goa": ["Konkani","Marathi","English"],
  "Gujarat": ["Gujarati","Hindi"],
  "Haryana": ["Hindi","Haryanvi"],
  "Himachal Pradesh": ["Hindi","Pahari","English"],
  "Jharkhand": ["Hindi","Santali","Mundari"],
  "Karnataka": ["Kannada","Hindi","English"],
  "Kerala": ["Malayalam","English"],
  "Madhya Pradesh": ["Hindi"],
  "Maharashtra": ["Marathi","Hindi"],
  "Manipur": ["Meitei","Hindi","English"],
  "Meghalaya": ["Khasi","English","Hindi"],
  "Mizoram": ["Mizo","English"],
  "Nagaland": ["Nagamese","English"],
  "Odisha": ["Odia","Hindi","English"],
  "Punjab": ["Punjabi","Hindi"],
  "Rajasthan": ["Hindi","Rajasthani"],
  "Sikkim": ["Nepali","Hindi","English"],
  "Tamil Nadu": ["Tamil","English"],
  "Telangana": ["Telugu","Hindi","English"],
  "Tripura": ["Bengali","Kokborok","Hindi"],
  "Uttar Pradesh": ["Hindi","Urdu"],
  "Uttarakhand": ["Hindi","Garhwali","Kumaoni"],
  "West Bengal": ["Bengali","Hindi","English"],
  "Delhi": ["Hindi","English","Punjabi"],
  "Jammu and Kashmir": ["Kashmiri","Dogri","Urdu","Hindi"],
  "Ladakh": ["Ladakhi","Hindi","English"],
  "Chandigarh": ["Hindi","Punjabi","English"],
  "Puducherry": ["Tamil","French","English"],
  "Lakshadweep": ["Malayalam","English"],
  "Andaman and Nicobar Islands": ["Hindi","Bengali","Tamil","Telugu","English"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Gujarati","Hindi"],
};

// ── Photos (pool of Unsplash headshots) ─────────────────────────────────────
const PHOTOS_MALE = [
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1566492031773-4f4e44671857?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1620122303020-43ec4b6cf7f8?auto=format&fit=crop&w=300&h=300&q=80",
];
const PHOTOS_FEMALE = [
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1573497019236-17f8177b81e8?auto=format&fit=crop&w=300&h=300&q=80",
  "https://images.unsplash.com/photo-1594744803329-e58b31de215f?auto=format&fit=crop&w=300&h=300&q=80",
];

// ── Seeded PRNG (deterministic, no randomness between runs) ─────────────────
function seededRng(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function pickIdx(arr, rng) { return Math.floor(rng() * arr.length); }

// ── Region detection ─────────────────────────────────────────────────────────
function getNamePool(state) {
  if (["Punjab","Haryana","Chandigarh","Himachal Pradesh"].includes(state))
    return { first: PUNJAB_FIRST, last: PUNJAB_LAST };
  if (["Tamil Nadu","Kerala","Karnataka","Andhra Pradesh","Telangana","Puducherry"].includes(state))
    return { first: SOUTH_FIRST, last: SOUTH_LAST };
  if (["Maharashtra","Goa"].includes(state))
    return { first: WEST_FIRST, last: WEST_LAST };
  if (["Gujarat","Dadra and Nagar Haveli and Daman and Diu"].includes(state))
    return { first: [...WEST_FIRST.slice(0,15), "Kalpesh","Jayesh","Dhruv","Hetal","Rima"], last: WEST_LAST.slice(0,10) };
  if (["West Bengal","Odisha","Assam","Tripura","Meghalaya","Manipur","Mizoram","Nagaland","Arunachal Pradesh","Sikkim"].includes(state))
    return { first: EAST_FIRST, last: EAST_LAST };
  if (["Jharkhand","Chhattisgarh"].includes(state))
    return { first: [...NORTH_FIRST.slice(0,20), ...TRIBAL_FIRST.slice(0,10)], last: [...NORTH_LAST.slice(0,15), ...TRIBAL_LAST.slice(0,10)] };
  return { first: NORTH_FIRST, last: NORTH_LAST };
}

function getGender(rng) { return rng() < 0.35 ? "F" : "M"; }
function getTitle(qual, gender) {
  if (qual.startsWith("Ph.D")) return "Dr.";
  if (qual.startsWith("B.Tech") || qual.startsWith("M.Tech")) return "Er.";
  return gender === "F" ? "Ms." : "Mr.";
}

// ── Bio generator ────────────────────────────────────────────────────────────
const BIO_TEMPLATES = [
  (name, spec, dist, state) => `${name} is a trusted agricultural advisor specialising in ${spec} for farmers across ${dist} and the surrounding ${state} region.`,
  (name, spec, dist, state) => `${name} has been serving the farming community of ${dist}, ${state} with expert guidance on ${spec} for over a decade.`,
  (name, spec, dist, state) => `A dedicated agri-consultant, ${name} helps smallholder farmers in ${dist} overcome challenges related to ${spec}.`,
  (name, spec, dist, state) => `${name} brings field-tested expertise on ${spec} to rural farm households across ${dist}, contributing to higher yields and better incomes.`,
  (name, spec, dist, state) => `With deep roots in ${state} agriculture, ${name} focuses on practical solutions for ${spec} challenges faced by ${dist} farmers.`,
];

// ── Education templates ──────────────────────────────────────────────────────
const UNIVERSITIES = {
  "Andhra Pradesh": ["ANGRAU Guntur","RPCAU Andhra Pradesh"],
  "Arunachal Pradesh": ["Central Agricultural University Imphal","NERIST Nirjuli"],
  "Assam": ["Assam Agricultural University","Central Agricultural University"],
  "Bihar": ["RPCAU Pusa","BAU Sabour","BHU Varanasi"],
  "Chhattisgarh": ["IGKV Raipur","CSVTU Bhilai"],
  "Goa": ["Goa University","KVK Goa"],
  "Gujarat": ["Anand Agricultural University","JAU Junagadh","NAU Navsari"],
  "Haryana": ["CCS HAU Hisar","NDRI Karnal"],
  "Himachal Pradesh": ["CSK HPKV Palampur","ICAR-IHBT Palampur"],
  "Jharkhand": ["BAU Ranchi","SHUATS Allahabad"],
  "Karnataka": ["UAS Bengaluru","UAS Dharwad","KSCST Bengaluru"],
  "Kerala": ["KCAET Tavanur","Kerala Agricultural University"],
  "Madhya Pradesh": ["JNKVV Jabalpur","RVSKVV Gwalior","NDVSU Jabalpur"],
  "Maharashtra": ["MPKV Rahuri","VNMKV Parbhani","PDKV Akola","Mahatma Phule KV"],
  "Manipur": ["Central Agricultural University","Manipur University"],
  "Meghalaya": ["NEHU Shillong","CAU Imphal"],
  "Mizoram": ["Mizoram University","CAU Imphal"],
  "Nagaland": ["Nagaland University","CAU Imphal"],
  "Odisha": ["OUAT Bhubaneswar","Sambalpur University"],
  "Punjab": ["Punjab Agricultural University","Guru Nanak Dev University"],
  "Rajasthan": ["MPUAT Udaipur","SKRAU Bikaner","CAZRI Jodhpur"],
  "Sikkim": ["Sikkim University","CAU Imphal"],
  "Tamil Nadu": ["TNAU Coimbatore","Tamil Nadu Veterinary & Animal Sciences University"],
  "Telangana": ["PJTSAU Hyderabad","Osmania University"],
  "Tripura": ["Tripura University","CAU Imphal"],
  "Uttar Pradesh": ["G.B. Pant University","BHU Varanasi","CSAUA&T Kanpur","SHUATS Allahabad"],
  "Uttarakhand": ["G.B. Pant University","HNB Garhwal University"],
  "West Bengal": ["BCKV Mohanpur","Visva-Bharati University"],
  "Delhi": ["IARI New Delhi","Delhi University"],
  "Jammu and Kashmir": ["SKUAST Jammu","SKUAST Kashmir"],
  "Ladakh": ["SKUAST Kashmir"],
  "Chandigarh": ["PAU Ludhiana","PU Chandigarh"],
  "Puducherry": ["Pondicherry University","TNAU Coimbatore"],
  "Lakshadweep": ["Kerala Agricultural University"],
  "Andaman and Nicobar Islands": ["CARI Port Blair"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Anand Agricultural University"],
};

function getUniversity(state) {
  const list = UNIVERSITIES[state] || ["IARI New Delhi"];
  return list[0];
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMPLETE DISTRICT DATABASE  [state → [[district, lat, lng], ...]]
// ══════════════════════════════════════════════════════════════════════════════
const DISTRICT_DATA = {

  "Andhra Pradesh": [
    ["Alluri Sitharama Raju",18.3031,83.0178],["Anakapalli",17.6914,83.0043],
    ["Ananthapuramu",14.6819,77.6006],["Bapatla",15.9108,80.4680],
    ["Eluru",16.7107,81.0953],["East Godavari",17.3002,82.0235],
    ["Guntur",16.3067,80.4365],["Kadapa",14.4674,78.8241],
    ["Kakinada",16.9891,82.2475],["Konaseema",16.8000,81.8000],
    ["Krishna",16.4037,80.6063],["Kurnool",15.8281,78.0373],
    ["Nandyal",15.4786,78.4839],["NTR",16.5062,80.6480],
    ["Palnadu",16.3214,79.6364],["Parvathipuram Manyam",18.7813,83.4261],
    ["Prakasam",15.3473,80.0568],["Srikakulam",18.2949,83.8935],
    ["Sri Potti Sriramulu Nellore",14.4426,79.9865],["Sri Sathya Sai",14.1653,77.7895],
    ["Tirupati",13.6288,79.4192],["Visakhapatnam",17.6868,83.2185],
    ["Vizianagaram",18.1066,83.3956],["West Godavari",16.9107,81.3397],
  ],

  "Arunachal Pradesh": [
    ["Anjaw",28.1050,96.8240],["Changlang",27.1330,95.7620],
    ["East Kameng",27.1200,93.4250],["East Siang",28.0570,95.3200],
    ["Itanagar",27.0844,93.6053],["Kamle",27.8910,93.7000],
    ["Kra Daadi",27.8610,93.3180],["Kurung Kumey",27.9280,93.0700],
    ["Lohit",28.0380,96.1680],["Longding",26.9430,95.5620],
    ["Lower Dibang Valley",28.1560,95.7830],["Lower Siang",28.0390,94.2780],
    ["Lower Subansiri",27.4530,94.0420],["Namsai",27.6720,95.8070],
    ["Pakke Kessang",27.2280,93.2890],["Shi Yomi",28.2200,94.7000],
    ["Siang",28.2480,95.0000],["Tawang",27.5860,91.8590],
    ["Tirap",27.0230,95.5390],["Upper Dibang Valley",28.2960,95.9680],
    ["Upper Siang",28.5500,95.2000],["Upper Subansiri",28.1400,94.4800],
    ["West Kameng",27.2540,92.4360],["West Siang",28.0770,94.7670],
    ["Dibang Valley",28.3800,95.6540],["Papum Pare",27.1000,93.5800],
  ],

  "Assam": [
    ["Bajali",26.5000,91.0000],["Barpeta",26.3227,91.0022],
    ["Biswanath",26.7342,93.1681],["Bongaigaon",26.4762,90.5582],
    ["Cachar",24.8090,92.7570],["Charaideo",27.2500,95.0000],
    ["Chirang",26.5000,90.6000],["Darrang",26.4400,92.0100],
    ["Dhemaji",27.4834,94.5649],["Dhubri",26.0200,89.9800],
    ["Dibrugarh",27.4728,94.9120],["Dima Hasao",25.5764,93.0360],
    ["Goalpara",26.1694,90.6255],["Golaghat",26.5165,93.9661],
    ["Hailakandi",24.6800,92.5600],["Hojai",26.0017,92.8571],
    ["Jorhat",26.7520,94.2020],["Kamrup",26.1445,91.7362],
    ["Kamrup Metropolitan",26.1445,91.7362],["Karbi Anglong",25.9940,93.3630],
    ["Karimganj",24.8660,92.3540],["Kokrajhar",26.3987,90.2699],
    ["Lakhimpur",27.2350,94.1070],["Majuli",26.9500,94.1700],
    ["Morigaon",26.2469,92.3393],["Nagaon",26.3482,92.6836],
    ["Nalbari",26.4441,91.4385],["Sivasagar",26.9826,94.6407],
    ["Sonitpur",26.6327,92.7902],["South Salmara Mankachar",25.0850,89.8260],
    ["Tinsukia",27.4930,95.3611],["Udalguri",26.7554,92.1024],
    ["West Karbi Anglong",25.7000,93.0000],["Baksa",26.6500,91.3000],
    ["Biswanath Chariali",26.7342,93.1681],
  ],

  "Bihar": [
    ["Araria",26.1528,87.4731],["Arwal",25.2433,84.6815],
    ["Aurangabad",24.7535,84.3744],["Banka",24.8840,86.9200],
    ["Begusarai",25.4183,86.1272],["Bhagalpur",25.2425,86.9843],
    ["Bhojpur",25.5640,84.4439],["Buxar",25.5629,83.9797],
    ["Darbhanga",26.1542,85.8918],["East Champaran",26.6531,84.9173],
    ["Gaya",24.7955,85.0002],["Gopalganj",26.4695,84.4346],
    ["Jamui",24.9297,86.2243],["Jehanabad",25.2081,84.9897],
    ["Kaimur",25.0448,83.5875],["Katihar",25.5406,87.5782],
    ["Khagaria",25.5018,86.4660],["Kishanganj",26.0994,87.9401],
    ["Lakhisarai",25.1550,86.0940],["Madhepura",25.9206,86.7918],
    ["Madhubani",26.3568,86.0731],["Munger",25.3760,86.4733],
    ["Muzaffarpur",26.1209,85.3647],["Nalanda",25.1351,85.4388],
    ["Nawada",24.8810,85.5407],["Patna",25.5941,85.1376],
    ["Purnia",25.7771,87.4753],["Rohtas",24.9867,84.0277],
    ["Saharsa",25.8786,86.5980],["Samastipur",25.8636,85.7803],
    ["Saran",25.9141,84.7479],["Sheikhpura",25.1410,85.8511],
    ["Sheohar",26.5213,85.2989],["Sitamarhi",26.5921,85.4804],
    ["Siwan",26.2203,84.3554],["Supaul",26.1263,86.6026],
    ["Vaishali",25.6900,85.2100],["West Champaran",27.2643,84.3000],
  ],

  "Chhattisgarh": [
    ["Balod",20.7310,81.2060],["Baloda Bazar",21.6566,82.1606],
    ["Balrampur",23.1050,83.5630],["Bastar",19.1150,81.9530],
    ["Bemetara",21.7180,81.5380],["Bijapur",18.8300,80.2500],
    ["Bilaspur",22.0796,82.1391],["Dantewada",18.8960,81.3490],
    ["Dhamtari",20.7080,81.5490],["Durg",21.1904,81.2849],
    ["Gariaband",20.6350,82.0650],["Gaurela Pendra Marwahi",22.5500,81.7800],
    ["Janjgir Champa",21.8768,82.5712],["Jashpur",22.8843,84.1393],
    ["Kabirdham",22.0960,81.2270],["Kanker",20.2683,81.4914],
    ["Khairagarh Chhuikhadan Gandai",21.4172,81.0121],["Kondagaon",19.5976,81.6614],
    ["Korba",22.3595,82.7501],["Koriya",23.3122,82.7270],
    ["Mahasamund",21.1096,82.0956],["Manendragarh Chirmiri Bharatpur",23.2100,82.2100],
    ["Mohla Manpur Ambagarh Chowki",21.0600,80.9600],["Mungeli",22.0620,81.6850],
    ["Narayanpur",19.6960,81.2490],["Raigarh",21.8974,83.3967],
    ["Raipur",21.2514,81.6296],["Rajnandgaon",21.0974,81.0291],
    ["Sakti",21.9900,82.9700],["Sarangarh Bilaigarh",21.5300,83.0800],
    ["Sukma",18.3920,81.6600],["Surajpur",23.2116,82.8672],
    ["Surguja",23.1180,83.0600],
  ],

  "Goa": [
    ["North Goa",15.4909,73.8278],["South Goa",15.1735,74.0236],
  ],

  "Gujarat": [
    ["Ahmedabad",23.0225,72.5714],["Amreli",21.6048,71.2213],
    ["Anand",22.5645,72.9289],["Aravalli",23.5021,73.1038],
    ["Banaskantha",24.1735,72.4332],["Bharuch",21.7051,72.9959],
    ["Bhavnagar",21.7645,72.1519],["Botad",22.1690,71.6670],
    ["Chhota Udaipur",22.3080,74.0150],["Dahod",22.8342,74.2575],
    ["Dang",20.7497,73.7129],["Devbhoomi Dwarka",22.2394,69.0047],
    ["Gandhinagar",23.2156,72.6369],["Gir Somnath",20.9030,70.3693],
    ["Jamnagar",22.4707,70.0577],["Junagadh",21.5222,70.4579],
    ["Kheda",22.7497,72.6848],["Kutch",23.7337,69.8597],
    ["Mahisagar",23.1067,73.5523],["Mehsana",23.5880,72.3693],
    ["Morbi",22.8143,70.8378],["Narmada",21.8713,73.4895],
    ["Navsari",20.9467,72.9520],["Panchmahal",22.7525,73.5920],
    ["Patan",23.8493,72.1266],["Porbandar",21.6440,69.6020],
    ["Rajkot",22.3039,70.8022],["Sabarkantha",23.3600,73.0100],
    ["Surat",21.1702,72.8311],["Surendranagar",22.7278,71.6381],
    ["Tapi",21.1220,73.4830],["Vadodara",22.3072,73.1812],
    ["Valsad",20.6052,72.9277],
  ],

  "Haryana": [
    ["Ambala",30.3782,76.7767],["Bhiwani",28.7978,76.1295],
    ["Charkhi Dadri",28.5920,76.2714],["Faridabad",28.4089,77.3178],
    ["Fatehabad",29.5165,75.4559],["Gurugram",28.4595,77.0266],
    ["Hisar",29.1492,75.7217],["Jhajjar",28.6072,76.6524],
    ["Jind",29.3161,76.3148],["Kaithal",29.8013,76.3983],
    ["Karnal",29.6857,76.9905],["Kurukshetra",29.9695,76.8783],
    ["Mahendragarh",28.2680,76.1470],["Nuh",28.1105,77.0032],
    ["Palwal",28.1471,77.3320],["Panchkula",30.6942,76.8606],
    ["Panipat",29.3909,76.9635],["Rewari",28.1972,76.6166],
    ["Rohtak",28.8955,76.6066],["Sirsa",29.5336,75.0281],
    ["Sonipat",28.9288,77.0127],["Yamunanagar",30.1290,77.2674],
  ],

  "Himachal Pradesh": [
    ["Bilaspur",31.3387,76.7600],["Chamba",32.5534,76.1248],
    ["Hamirpur",31.6856,76.5214],["Kangra",32.0998,76.2691],
    ["Kinnaur",31.5781,78.3523],["Kullu",31.9592,77.1089],
    ["Lahaul Spiti",32.4290,77.5999],["Mandi",31.7080,76.9318],
    ["Shimla",31.1048,77.1734],["Sirmaur",30.5615,77.4718],
    ["Solan",30.9045,77.0967],["Una",31.4715,76.2701],
  ],

  "Jharkhand": [
    ["Bokaro",23.6693,86.1511],["Chatra",24.2026,84.8768],
    ["Deoghar",24.4853,86.6961],["Dhanbad",23.7957,86.4304],
    ["Dumka",24.2654,87.2517],["East Singhbhum",22.7767,86.1988],
    ["Garhwa",24.1651,83.7935],["Giridih",24.1877,86.2977],
    ["Godda",24.8264,87.2098],["Gumla",23.0439,84.5434],
    ["Hazaribagh",23.9925,85.3637],["Jamtara",23.9569,86.8059],
    ["Khunti",23.0723,85.2779],["Koderma",24.4642,85.5948],
    ["Latehar",23.7440,84.4980],["Lohardaga",23.4359,84.6870],
    ["Pakur",24.6341,87.8344],["Palamu",24.0291,84.0764],
    ["Ramgarh",23.6330,85.5130],["Ranchi",23.3441,85.3096],
    ["Sahebganj",25.2451,87.6455],["Seraikela Kharsawan",22.5500,85.8950],
    ["Simdega",22.6138,84.5131],["West Singhbhum",22.5400,85.8370],
  ],

  "Karnataka": [
    ["Bagalkot",16.1691,75.6965],["Ballari",15.1394,76.9214],
    ["Belagavi",15.8497,74.4977],["Bengaluru Rural",13.0827,77.5877],
    ["Bengaluru Urban",12.9716,77.5946],["Bidar",17.9133,77.5200],
    ["Chamarajanagar",11.9210,76.9430],["Chikkaballapur",13.4355,77.7283],
    ["Chikkamagaluru",13.3161,75.7720],["Chitradurga",14.2290,76.3980],
    ["Dakshina Kannada",12.8438,75.2479],["Davanagere",14.4644,75.9218],
    ["Dharwad",15.4589,75.0078],["Gadag",15.4167,75.6167],
    ["Hassan",13.0000,76.1000],["Haveri",14.7950,75.3983],
    ["Kalaburagi",17.3297,76.8200],["Kodagu",12.4244,75.7380],
    ["Kolar",13.1360,78.1294],["Koppal",15.3548,76.1550],
    ["Mandya",12.5218,76.8951],["Mysuru",12.2958,76.6394],
    ["Raichur",16.2120,77.3439],["Ramanagara",12.7157,77.2798],
    ["Shivamogga",13.9299,75.5681],["Tumakuru",13.3379,77.1173],
    ["Udupi",13.3409,74.7421],["Uttara Kannada",14.8157,74.1268],
    ["Vijayapura",16.8302,75.7100],["Vijayanagara",15.1394,76.9214],
    ["Yadgir",16.7642,77.1394],
  ],

  "Kerala": [
    ["Alappuzha",9.4981,76.3388],["Ernakulam",10.0159,76.3419],
    ["Idukki",9.9189,77.1025],["Kannur",11.8745,75.3704],
    ["Kasaragod",12.4996,74.9869],["Kollam",8.8932,76.6141],
    ["Kottayam",9.5916,76.5222],["Kozhikode",11.2588,75.7804],
    ["Malappuram",11.0510,76.0711],["Palakkad",10.7867,76.6548],
    ["Pathanamthitta",9.2648,76.7870],["Thiruvananthapuram",8.5241,76.9366],
    ["Thrissur",10.5276,76.2144],["Wayanad",11.6854,76.1320],
  ],

  "Madhya Pradesh": [
    ["Agar Malwa",23.7100,76.0140],["Alirajpur",22.2990,74.3610],
    ["Anuppur",23.1003,81.6888],["Ashoknagar",24.5800,77.7300],
    ["Balaghat",21.8144,80.1870],["Barwani",22.0340,74.9000],
    ["Betul",21.9100,77.9100],["Bhind",26.5613,78.7880],
    ["Bhopal",23.2599,77.4126],["Burhanpur",21.3100,76.2300],
    ["Chhatarpur",24.9149,79.5900],["Chhindwara",22.0574,78.9382],
    ["Damoh",23.8322,79.4440],["Datia",25.6650,78.4650],
    ["Dewas",22.9622,76.0508],["Dhar",22.5980,75.2990],
    ["Dindori",22.9450,81.0790],["Guna",24.6476,77.3147],
    ["Gwalior",26.2183,78.1828],["Harda",22.3414,77.0920],
    ["Hoshangabad",22.7470,77.7270],["Indore",22.7196,75.8577],
    ["Jabalpur",23.1815,79.9864],["Jhabua",22.7680,74.5970],
    ["Katni",23.8319,80.3983],["Khandwa",21.8264,76.3524],
    ["Khargone",21.8257,75.6116],["Mandla",22.5988,80.3786],
    ["Mandsaur",24.0765,75.0701],["Morena",26.5038,77.9981],
    ["Narsinghpur",22.9500,79.1900],["Neemuch",24.4770,74.8640],
    ["Niwari",25.0000,78.9000],["Panna",24.7186,80.1840],
    ["Raisen",23.3303,77.7896],["Rajgarh",23.6427,76.7277],
    ["Ratlam",23.3314,75.0367],["Rewa",24.5362,81.2963],
    ["Sagar",23.8390,78.7440],["Satna",24.5726,80.8322],
    ["Sehore",23.2032,77.0844],["Seoni",22.0893,79.5481],
    ["Shahdol",23.2963,81.3545],["Shajapur",23.4258,76.2754],
    ["Sheopur",25.6620,76.7080],["Shivpuri",25.4252,77.6679],
    ["Sidhi",24.4154,81.8743],["Singrauli",24.1997,82.6751],
    ["Tikamgarh",24.7430,78.8330],["Ujjain",23.1793,75.7849],
    ["Umaria",23.5200,80.8360],["Vidisha",23.5231,77.8133],
  ],

  "Maharashtra": [
    ["Ahmednagar",19.0948,74.7480],["Akola",20.7060,77.0080],
    ["Amravati",20.9374,77.7796],["Aurangabad",19.8762,75.3433],
    ["Beed",18.9890,75.7592],["Bhandara",21.1690,79.6510],
    ["Buldhana",20.5294,76.1840],["Chandrapur",19.9615,79.2961],
    ["Dhule",20.9042,74.7749],["Gadchiroli",19.5966,80.0052],
    ["Gondia",21.4614,80.1975],["Hingoli",19.7215,77.1490],
    ["Jalgaon",21.0077,75.5626],["Jalna",19.8349,75.8857],
    ["Kolhapur",16.7050,74.2433],["Latur",18.4088,76.5604],
    ["Mumbai City",18.9667,72.8333],["Mumbai Suburban",19.1136,72.8697],
    ["Nagpur",21.1458,79.0882],["Nanded",19.1583,77.3210],
    ["Nandurbar",21.3702,74.2415],["Nashik",19.9975,73.7898],
    ["Osmanabad",18.1860,76.0380],["Palghar",19.6967,72.7654],
    ["Parbhani",19.2704,76.7748],["Pune",18.5204,73.8567],
    ["Raigad",18.5158,73.1231],["Ratnagiri",16.9902,73.3120],
    ["Sangli",16.8524,74.5815],["Satara",17.6805,73.9918],
    ["Sindhudurg",16.0491,73.6840],["Solapur",17.6599,75.9064],
    ["Thane",19.2183,72.9781],["Wardha",20.7453,78.6022],
    ["Washim",20.1123,77.1441],["Yavatmal",20.3888,78.1204],
  ],

  "Manipur": [
    ["Bishnupur",24.6345,93.7660],["Chandel",24.3300,94.0200],
    ["Churachandpur",24.3336,93.6793],["Imphal East",24.8170,93.9368],
    ["Imphal West",24.8500,93.8950],["Jiribam",24.8000,93.1200],
    ["Kakching",24.5069,93.9845],["Kamjong",25.1000,94.6500],
    ["Kangpokpi",25.1255,93.9726],["Noney",24.6700,93.6500],
    ["Pherzawl",24.1500,93.3200],["Senapati",25.2756,94.0222],
    ["Tamenglong",24.9835,93.0096],["Tengnoupal",24.0000,94.1600],
    ["Thoubal",24.6407,94.0170],["Ukhrul",25.1205,94.3594],
  ],

  "Meghalaya": [
    ["East Garo Hills",25.6100,90.4500],["East Jaintia Hills",25.3769,92.4600],
    ["East Khasi Hills",25.5788,91.8933],["Eastern West Khasi Hills",25.4000,91.3000],
    ["North Garo Hills",26.1480,90.6320],["Ri Bhoi",25.7500,91.9000],
    ["South Garo Hills",25.1600,90.4780],["South West Garo Hills",25.5200,89.8400],
    ["South West Khasi Hills",25.0200,91.2600],["West Garo Hills",25.5744,90.2100],
    ["West Jaintia Hills",25.5500,92.2200],["West Khasi Hills",25.5100,91.4000],
  ],

  "Mizoram": [
    ["Aizawl",23.7271,92.7176],["Champhai",23.4590,93.3310],
    ["Hnahthial",23.0000,92.5800],["Khawzawl",23.7200,93.3300],
    ["Kolasib",24.2256,92.6854],["Lawngtlai",22.5327,92.9038],
    ["Lunglei",22.8893,92.7362],["Mamit",23.9200,92.4800],
    ["Saiha",22.4900,92.9800],["Saitual",23.7600,92.9200],
    ["Serchhip",23.3000,92.8500],
  ],

  "Nagaland": [
    ["Chumoukedima",25.6706,93.7240],["Dimapur",25.9091,93.7266],
    ["Kiphire",25.9000,94.5500],["Kohima",25.6751,94.1086],
    ["Longleng",26.6000,94.5000],["Mokokchung",26.3253,94.5234],
    ["Mon",26.7278,95.0296],["Noklak",26.8167,95.4000],
    ["Peren",25.5680,93.7250],["Phek",25.6645,94.4748],
    ["Shamator",25.9000,94.5000],["Tseminyu",25.8000,93.8500],
    ["Tuensang",26.2683,94.8167],["Wokha",26.1027,94.2617],
    ["Zunheboto",25.8477,94.5148],["Niuland",25.7500,94.1000],
  ],

  "Odisha": [
    ["Angul",20.8400,85.1010],["Balangir",20.7038,83.4875],
    ["Balasore",21.4934,86.9291],["Bargarh",21.3354,83.6198],
    ["Bhadrak",21.0561,86.4952],["Boudh",20.8403,84.3241],
    ["Cuttack",20.4625,85.8830],["Deogarh",21.5390,84.7350],
    ["Dhenkanal",20.6587,85.5963],["Gajapati",19.0689,84.1059],
    ["Ganjam",19.3867,84.6897],["Jagatsinghpur",20.2497,86.1678],
    ["Jajpur",20.8503,86.3394],["Jharsuguda",21.8556,84.0060],
    ["Kalahandi",19.9100,83.1700],["Kandhamal",20.1246,84.0022],
    ["Kendrapara",20.5020,86.4217],["Kendujhar",21.6280,85.5810],
    ["Khordha",20.1861,85.6225],["Koraput",18.8127,82.7110],
    ["Malkangiri",18.3450,81.8980],["Mayurbhanj",21.9322,86.7246],
    ["Nabarangpur",19.2296,82.5490],["Nayagarh",20.1289,85.0960],
    ["Nuapada",20.7900,82.5200],["Puri",19.8134,85.8315],
    ["Rayagada",19.1700,83.4200],["Sambalpur",21.4669,83.9812],
    ["Subarnapur",20.8300,83.9100],["Sundargarh",22.1153,84.0302],
  ],

  "Punjab": [
    ["Amritsar",31.6340,74.8723],["Barnala",30.3800,75.5500],
    ["Bathinda",30.2110,74.9455],["Faridkot",30.6739,74.7561],
    ["Fatehgarh Sahib",30.6500,76.3900],["Fazilka",30.4001,74.0249],
    ["Firozpur",30.9350,74.6070],["Gurdaspur",32.0380,75.4020],
    ["Hoshiarpur",31.5341,75.9112],["Jalandhar",31.3260,75.5762],
    ["Kapurthala",31.3800,75.3900],["Ludhiana",30.9010,75.8573],
    ["Malerkotla",30.5300,75.8800],["Mansa",29.9900,75.3900],
    ["Moga",30.8168,75.1725],["Muktsar",30.4737,74.5168],
    ["Nawanshahr",31.1234,76.1171],["Pathankot",32.2690,75.6524],
    ["Patiala",30.3398,76.3869],["Rupnagar",30.9739,76.5210],
    ["Sangrur",30.2370,75.8409],["Tarn Taran",31.4516,74.9295],
  ],

  "Rajasthan": [
    ["Ajmer",26.4499,74.6399],["Alwar",27.5630,76.6346],
    ["Banswara",23.5455,74.4418],["Baran",25.0937,76.5134],
    ["Barmer",25.7482,71.3995],["Bharatpur",27.2152,77.4941],
    ["Bhilwara",25.3464,74.6345],["Bikaner",28.0229,73.3119],
    ["Bundi",25.4371,75.6504],["Chittorgarh",24.8887,74.6269],
    ["Churu",28.2960,74.9667],["Dausa",26.8893,76.3344],
    ["Dholpur",26.7022,77.8874],["Dungarpur",23.8430,73.7147],
    ["Hanumangarh",29.5749,74.3268],["Jaipur",26.9124,75.7873],
    ["Jaisalmer",26.9157,70.9083],["Jalore",25.3464,72.6143],
    ["Jhalawar",24.5984,76.1583],["Jhunjhunu",28.1322,75.3990],
    ["Jodhpur",26.2389,73.0243],["Karauli",26.5025,77.0188],
    ["Kota",25.2138,75.8648],["Nagaur",27.2039,73.7319],
    ["Pali",25.7735,73.3234],["Pratapgarh",24.0349,74.7779],
    ["Rajsamand",25.0693,73.8836],["Sawai Madhopur",26.0200,76.3511],
    ["Sikar",27.6094,75.1398],["Sirohi",24.8884,72.8633],
    ["Sri Ganganagar",29.9038,73.8772],["Tonk",26.1697,75.7894],
    ["Udaipur",24.5854,73.7125],
  ],

  "Sikkim": [
    ["East Sikkim",27.3389,88.6065],["North Sikkim",27.7356,88.5654],
    ["Pakyong",27.2100,88.6400],["Soreng",27.1600,88.1800],
    ["South Sikkim",27.1470,88.5000],["West Sikkim",27.3000,88.2500],
  ],

  "Tamil Nadu": [
    ["Ariyalur",11.1418,79.0769],["Chengalpattu",12.6921,79.9760],
    ["Chennai",13.0827,80.2707],["Coimbatore",11.0168,76.9558],
    ["Cuddalore",11.7480,79.7714],["Dharmapuri",12.1277,78.1582],
    ["Dindigul",10.3624,77.9695],["Erode",11.3410,77.7172],
    ["Kallakurichi",11.7373,78.9610],["Kancheepuram",12.8333,79.7060],
    ["Karur",10.9601,78.0766],["Krishnagiri",12.5266,78.2136],
    ["Madurai",9.9252,78.1198],["Mayiladuthurai",11.1015,79.6540],
    ["Nagapattinam",10.7672,79.8420],["Namakkal",11.2195,78.1673],
    ["Nilgiris",11.3780,76.7440],["Perambalur",11.2335,78.8797],
    ["Pudukkottai",10.3797,78.8198],["Ramanathapuram",9.3762,78.8308],
    ["Ranipet",12.9285,79.3342],["Salem",11.6643,78.1460],
    ["Sivaganga",9.8438,78.4800],["Tenkasi",8.9600,77.3100],
    ["Thanjavur",10.7870,79.1378],["Theni",10.0104,77.4767],
    ["Thoothukudi",8.7642,78.1348],["Tiruchirappalli",10.7905,78.7047],
    ["Tirunelveli",8.7139,77.7567],["Tirupattur",12.4968,78.5656],
    ["Tiruppur",11.1085,77.3411],["Tiruvallur",13.1432,79.9079],
    ["Tiruvannamalai",12.2253,79.0747],["Tiruvarur",10.7726,79.6374],
    ["Vellore",12.9165,79.1325],["Viluppuram",11.9390,79.4970],
    ["Virudhunagar",9.5851,77.9624],["Kanniyakumari",8.0883,77.5385],
  ],

  "Telangana": [
    ["Adilabad",19.6640,78.5321],["Bhadradri Kothagudem",17.5555,80.6187],
    ["Hanumakonda",17.9784,79.6011],["Hyderabad",17.3850,78.4867],
    ["Jagtial",18.7880,78.9150],["Jangaon",17.7250,79.1680],
    ["Jayashankar Bhupalpally",18.4399,80.3855],["Jogulamba Gadwal",16.2336,77.8035],
    ["Kamareddy",18.3205,78.3398],["Karimnagar",18.4386,79.1288],
    ["Khammam",17.2473,80.1514],["Kumuram Bheem Asifabad",19.3700,79.2800],
    ["Mahabubabad",17.5970,80.0050],["Mahabubnagar",16.7488,77.9862],
    ["Mancherial",18.8690,79.4510],["Medak",17.9981,77.9855],
    ["Medchal Malkajgiri",17.5404,78.5313],["Mulugu",18.1950,80.2700],
    ["Nagarkurnool",16.4840,78.3220],["Nalgonda",17.0574,79.2671],
    ["Narayanpet",16.7436,77.4968],["Nirmal",19.1013,78.3440],
    ["Nizamabad",18.6725,78.0942],["Peddapalli",18.6152,79.3800],
    ["Rajanna Sircilla",18.3870,78.8300],["Rangareddy",17.2952,78.5738],
    ["Sangareddy",17.6270,78.0872],["Siddipet",18.1053,78.8522],
    ["Suryapet",17.1405,79.6218],["Vikarabad",17.3389,77.9048],
    ["Wanaparthy",16.3530,78.0640],["Warangal",17.9689,79.5941],
    ["Yadadri Bhuvanagiri",17.5819,78.7700],
  ],

  "Tripura": [
    ["Dhalai",23.8245,91.8101],["Gomati",23.2660,91.6980],
    ["Khowai",24.0584,91.6049],["North Tripura",24.3500,92.2000],
    ["Sepahijala",23.4800,91.2900],["Sipahijala",23.4800,91.2900],
    ["South Tripura",23.0000,91.5900],["Unakoti",24.1300,92.0000],
    ["West Tripura",23.8315,91.4000],
  ],

  "Uttar Pradesh": [
    ["Agra",27.1767,78.0081],["Aligarh",27.8974,78.0880],
    ["Ambedkar Nagar",26.4480,82.5500],["Amethi",26.1530,81.8060],
    ["Amroha",28.9022,78.4671],["Auraiya",26.4639,79.5195],
    ["Ayodhya",26.7922,82.1998],["Azamgarh",26.0673,83.1836],
    ["Baghpat",28.9444,77.2168],["Bahraich",27.5744,81.5958],
    ["Ballia",25.7571,84.1470],["Balrampur",27.4305,82.1873],
    ["Banda",25.4795,80.3355],["Barabanki",26.9277,81.1856],
    ["Bareilly",28.3640,79.4150],["Basti",26.7981,82.7277],
    ["Bhadohi",25.4105,82.5699],["Bijnor",29.3721,78.1351],
    ["Budaun",28.0368,79.1310],["Bulandshahr",28.4072,77.8552],
    ["Chandauli",25.2684,83.2693],["Chitrakoot",25.2008,80.8983],
    ["Deoria",26.5034,83.7774],["Etah",27.5567,78.6660],
    ["Etawah",26.7855,79.0085],["Farrukhabad",27.3935,79.5792],
    ["Fatehpur",25.9292,80.8117],["Firozabad",27.1492,78.3957],
    ["Gautam Buddha Nagar",28.5355,77.3910],["Ghaziabad",28.6692,77.4538],
    ["Ghazipur",25.5788,83.5719],["Gonda",27.1337,81.9583],
    ["Gorakhpur",26.7606,83.3732],["Hamirpur",25.9504,80.1500],
    ["Hapur",28.7299,77.7745],["Hardoi",27.3985,80.1340],
    ["Hathras",27.5900,78.0600],["Jalaun",25.8498,79.3317],
    ["Jaunpur",25.7468,82.6842],["Jhansi",25.4484,78.5685],
    ["Kannauj",27.0581,79.9200],["Kanpur Dehat",26.3800,79.7500],
    ["Kanpur Nagar",26.4499,80.3319],["Kasganj",27.8100,78.6500],
    ["Kaushambi",25.5400,81.3800],["Kheri",28.4200,80.7900],
    ["Kushinagar",26.7523,83.8914],["Lalitpur",24.6882,78.4117],
    ["Lucknow",26.8467,80.9462],["Maharajganj",27.1300,83.5600],
    ["Mahoba",25.2880,79.8710],["Mainpuri",27.2330,79.0200],
    ["Mathura",27.4924,77.6737],["Mau",25.9414,83.5590],
    ["Meerut",28.9845,77.7064],["Mirzapur",25.1465,82.5717],
    ["Moradabad",28.8386,78.7733],["Muzaffarnagar",29.4700,77.7100],
    ["Pilibhit",28.6361,79.8055],["Pratapgarh",25.8905,81.9868],
    ["Prayagraj",25.4358,81.8463],["Rae Bareli",26.2181,81.2321],
    ["Rampur",28.8188,79.0245],["Saharanpur",29.9640,77.5462],
    ["Sambhal",28.5900,78.5700],["Sant Kabir Nagar",27.0950,82.9870],
    ["Shahjahanpur",27.8810,79.9050],["Shamli",29.4494,77.3080],
    ["Shravasti",27.5700,81.8700],["Siddharthnagar",27.2945,83.0586],
    ["Sitapur",27.5632,80.6794],["Sonbhadra",24.3550,82.7660],
    ["Sultanpur",26.2643,82.0728],["Unnao",26.5449,80.4901],
    ["Varanasi",25.3176,82.9739],
  ],

  "Uttarakhand": [
    ["Almora",29.5979,79.6591],["Bageshwar",29.8361,79.7706],
    ["Chamoli",30.4098,79.3216],["Champawat",29.3329,80.0914],
    ["Dehradun",30.3165,78.0322],["Haridwar",29.9457,78.1642],
    ["Nainital",29.3919,79.4542],["Pauri Garhwal",29.7693,78.8000],
    ["Pithoragarh",29.5830,80.2184],["Rudraprayag",30.2949,78.9811],
    ["Tehri Garhwal",30.3930,78.4800],["Udham Singh Nagar",28.9944,79.5210],
    ["Uttarkashi",30.7268,78.4537],
  ],

  "West Bengal": [
    ["Alipurduar",26.4875,89.5208],["Bankura",23.2324,87.0753],
    ["Birbhum",23.9038,87.5290],["Cooch Behar",26.3244,89.4430],
    ["Dakshin Dinajpur",25.3296,88.7514],["Darjeeling",27.0360,88.2627],
    ["Hooghly",22.9015,88.3940],["Howrah",22.5958,88.2636],
    ["Jalpaiguri",26.5432,88.7231],["Jhargram",22.4503,86.9948],
    ["Kalimpong",27.0660,88.4751],["Kolkata",22.5726,88.3639],
    ["Malda",25.0007,88.1415],["Murshidabad",24.1750,88.2804],
    ["Nadia",23.4712,88.5500],["North 24 Parganas",22.6900,88.4000],
    ["Paschim Bardhaman",23.2324,87.1000],["Paschim Medinipur",22.4267,87.3212],
    ["Purba Bardhaman",23.2324,87.8630],["Purba Medinipur",22.0500,87.7200],
    ["Purulia",23.3329,86.3647],["South 24 Parganas",22.1516,88.7416],
    ["Uttar Dinajpur",25.8000,88.1000],
  ],

  "Delhi": [
    ["Central Delhi",28.6562,77.2060],["East Delhi",28.6600,77.3100],
    ["New Delhi",28.6139,77.2090],["North Delhi",28.7218,77.2078],
    ["North East Delhi",28.7100,77.2900],["North West Delhi",28.7400,77.1200],
    ["Shahdara",28.6700,77.2900],["South Delhi",28.5500,77.2300],
    ["South East Delhi",28.5600,77.3100],["South West Delhi",28.5800,77.1000],
    ["West Delhi",28.6500,77.0900],
  ],

  "Jammu and Kashmir": [
    ["Anantnag",33.7311,75.1487],["Bandipora",34.4260,74.6356],
    ["Baramulla",34.1980,74.3640],["Budgam",33.9314,74.7207],
    ["Doda",33.1490,75.5470],["Ganderbal",34.2288,74.7747],
    ["Jammu",32.7266,74.8570],["Kathua",32.3820,75.5220],
    ["Kishtwar",33.3138,75.7607],["Kulgam",33.6436,75.0190],
    ["Kupwara",34.5248,74.2601],["Poonch",33.7740,74.0940],
    ["Pulwama",33.8769,74.9001],["Rajouri",33.3769,74.3120],
    ["Ramban",33.2399,75.2330],["Reasi",33.0770,74.8350],
    ["Samba",32.5730,75.1190],["Shopian",33.7147,74.8322],
    ["Srinagar",34.0837,74.7973],["Udhampur",32.9160,75.1416],
  ],

  "Ladakh": [
    ["Kargil",34.5539,76.1349],["Leh",34.1526,77.5771],
  ],

  "Chandigarh": [
    ["Chandigarh",30.7333,76.7794],
  ],

  "Puducherry": [
    ["Karaikal",10.9254,79.8380],["Mahe",11.7035,75.5350],
    ["Puducherry",11.9416,79.8083],["Yanam",16.7300,82.2136],
  ],

  "Andaman and Nicobar Islands": [
    ["Nicobar",7.0000,93.7333],["North and Middle Andaman",12.5792,92.9397],
    ["South Andaman",11.6234,92.7265],
  ],

  "Dadra and Nagar Haveli and Daman and Diu": [
    ["Dadra and Nagar Haveli",20.1809,72.9872],["Daman",20.3974,72.8328],
    ["Diu",20.7141,70.9876],
  ],

  "Lakshadweep": [
    ["Lakshadweep",10.5667,72.6417],
  ],
};

// ══════════════════════════════════════════════════════════════════════════════
//  GENERATE EXPERTS
// ══════════════════════════════════════════════════════════════════════════════
const experts = [];
let id = 1;

for (const [state, districts] of Object.entries(DISTRICT_DATA)) {
  const langs = LANG_MAP[state] || ["Hindi", "English"];
  const namePool = getNamePool(state);
  const university = getUniversity(state);

  for (const [district, lat, lng] of districts) {
    for (let i = 0; i < 3; i++) {
      const seed = id * 7919 + state.charCodeAt(0) * 31 + district.charCodeAt(0) * 13 + i * 101;
      const rng = seededRng(seed);

      const gender = getGender(rng);
      const firstName = pick(namePool.first, rng);
      const lastName = pick(namePool.last, rng);
      const qual = pick(QUALIFICATIONS, rng);
      const title = getTitle(qual, gender);
      const name = `${title} ${firstName} ${lastName}`;

      // Pick a unique specialization per expert
      const spec = SPECIALIZATIONS[(id + i) % SPECIALIZATIONS.length];
      const availability = AVAILABILITY[i % AVAILABILITY.length];
      const responseTime = pick(RESP_TIMES, rng);
      const experience = 4 + Math.floor(rng() * 18);
      const rating = +(4.2 + rng() * 0.79).toFixed(1);
      const reviews = 40 + Math.floor(rng() * 400);
      const visits = 100 + Math.floor(rng() * 1600);
      const fee = [200, 250, 280, 300, 320, 350, 370, 380, 400, 420, 450, 500][Math.floor(rng() * 12)];

      // Select languages
      const langCount = 1 + Math.floor(rng() * Math.min(3, langs.length));
      const selectedLangs = [...langs].sort(() => rng() - 0.5).slice(0, langCount);
      if (!selectedLangs.includes("English") && rng() > 0.6) selectedLangs.push("English");

      const bioTemplate = BIO_TEMPLATES[Math.floor(rng() * BIO_TEMPLATES.length)];
      const bio = bioTemplate(name, spec.toLowerCase(), district, state);

      const cleanName = name.replace(/^(Mr\.|Ms\.|Dr\.|Er\.)\s+/i, '');
      const photo = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=random&color=fff&size=256`;

      // Slightly offset coordinates so multiple experts are distributed in the vicinity
      const offsetLat = lat + (i - 1) * 0.015;
      const offsetLng = lng + (i - 1) * 0.015;

      experts.push({
        id, name, photo,
        qualification: qual,
        experience,
        specialization: spec,
        languages: selectedLangs,
        district, state,
        rating, reviews, visits,
        consultationFee: fee,
        availability,
        responseTime,
        bio,
        education: `${qual}, ${university}`,
        certifications: [`Agricultural Expert, ${state} State`],
        latitude: +offsetLat.toFixed(4),
        longitude: +offsetLng.toFixed(4),
      });

      id++;
    }
  }
}

// ── Write output ─────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, "consultants.js");

// `photo` is generated but no longer written: the page draws initials
// locally instead of loading a third-party avatar per expert.
const records = experts.map(e => ({
  id: e.id,
  name: e.name,
  qualification: e.qualification,
  experience: e.experience,
  specialization: e.specialization,
  languages: e.languages,
  district: e.district,
  state: e.state,
  rating: e.rating, reviews: e.reviews, visits: e.visits, consultationFee: e.consultationFee,
  availability: e.availability, responseTime: e.responseTime,
  bio: e.bio,
  education: e.education,
  certifications: e.certifications,
  latitude: e.latitude, longitude: e.longitude,
}));

const output = renderDataFile("CONSULTANTS_DATA", records,
`Consultants data — MittiMantra "Gyan Seva" feature
AUTO-GENERATED by generate_consultants.js — DO NOT EDIT MANUALLY.
${experts.length} experts • ${Object.keys(DISTRICT_DATA).length} states/UTs • Every Indian district covered.`);

fs.writeFileSync(outPath, output, "utf8");
console.log(`✅  Written ${experts.length} experts across ${Object.keys(DISTRICT_DATA).length} states/UTs → ${outPath}`);
