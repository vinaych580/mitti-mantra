/* =========================================================================
   Consultants data typescript definitions — MittiMantra "Gyan Seva"
   ========================================================================= */

export interface Consultant {
  id: number;
  name: string;
  photo: string;
  qualification: string;
  experience: number;
  specialization: string;
  languages: string[];
  district: string;
  state: string;
  rating: number;
  reviews: number;
  visits: number;
  consultationFee: number;
  availability: "Online" | "Offline" | "Available Tomorrow";
  responseTime: string;
  bio: string;
  education: string;
  certifications: string[];
  latitude: number;
  longitude: number;
}

export const CONSULTANTS_DATA: Consultant[] = [
  {
    id: 1,
    name: "Dr. Rajesh Kumar",
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "Ph.D. in Soil Science & Water Chemistry",
    experience: 12,
    specialization: "Soil does not retain water",
    languages: ["Hindi", "English"],
    district: "Sehore",
    state: "Madhya Pradesh",
    rating: 4.9,
    reviews: 352,
    visits: 1280,
    consultationFee: 450,
    availability: "Online",
    responseTime: "within 15 minutes",
    bio: "Dr. Rajesh Kumar is a senior soil chemist with over a decade of research and on-field experience in addressing dryland soil issues. He specializes in soil moisture retention technologies, organic additives, and sustainable land restoration in Central India.",
    education: "Ph.D. in Soil Science, Indian Agricultural Research Institute (IARI), New Delhi",
    certifications: ["Certified Soil Health Inspector (ICAR)", "Water Conservation Specialist, MoA&FW"],
    latitude: 23.2032,
    longitude: 77.0844
  },
  {
    id: 2,
    name: "Dr. Sunita Patil",
    photo: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "M.Sc. in Plant Pathology & Entomology",
    experience: 8,
    specialization: "Pest attack",
    languages: ["Marathi", "Hindi", "English"],
    district: "Pune",
    state: "Maharashtra",
    rating: 4.8,
    reviews: 218,
    visits: 840,
    consultationFee: 400,
    availability: "Available Tomorrow",
    responseTime: "within 1 hour",
    bio: "Dr. Sunita Patil is a leading plant pathologist based in Pune. She has successfully advised over 800 cotton, sugarcane, and fruit orchard growers in combating stubborn insect pests and fungal diseases using integrated pest management (IPM) practices.",
    education: "M.Sc. in Plant Pathology, Mahatma Phule Krishi Vidyapeeth (MPKV), Rahuri",
    certifications: ["Integrated Pest Management Practitioner License", "Crop Protection Consultant Certification"],
    latitude: 18.5204,
    longitude: 73.8567
  },
  {
    id: 3,
    name: "Er. Amit Mishra",
    photo: "https://images.unsplash.com/photo-1620122303020-43ec4b6cf7f8?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "B.Tech. in Agricultural Engineering",
    experience: 10,
    specialization: "Irrigation planning",
    languages: ["Hindi", "English"],
    district: "Lucknow",
    state: "Uttar Pradesh",
    rating: 4.7,
    reviews: 175,
    visits: 620,
    consultationFee: 350,
    availability: "Online",
    responseTime: "within 30 minutes",
    bio: "Amit Mishra is an agricultural design engineer specializing in modern micro-irrigation systems. He designs drip, sprinkler, and automated smart-watering layouts that maximize crop yield while saving up to 40% water.",
    education: "B.Tech. in Agricultural Engineering, G. B. Pant University of Agriculture and Technology",
    certifications: ["Micro-Irrigation Designer (National Irrigation Board)", "Precision Irrigation System Integrator"],
    latitude: 26.8467,
    longitude: 80.9462
  },
  {
    id: 4,
    name: "Dr. Vijay Deshmukh",
    photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "Ph.D. in Agronomy & Organic Farming",
    experience: 15,
    specialization: "Organic farming",
    languages: ["Marathi", "Hindi"],
    district: "Pune",
    state: "Maharashtra",
    rating: 4.95,
    reviews: 412,
    visits: 1980,
    consultationFee: 500,
    availability: "Available Tomorrow",
    responseTime: "within 2 hours",
    bio: "Dr. Vijay Deshmukh is a pioneer in regenerative agriculture and biological pest control in Western Maharashtra. He helps farmers transition from chemical-heavy farming to profitable, certified organic models.",
    education: "Ph.D. in Agronomy, Vasantrao Naik Marathwada Krishi Vidyapeeth",
    certifications: ["NPOP Organic Standards Lead Auditor", "Permaculture Design Certificate (PDC)"],
    latitude: 18.0689,
    longitude: 74.5812
  },
  {
    id: 5,
    name: "Ms. Priya Sharma",
    photo: "https://images.unsplash.com/photo-1594744803329-e58b31de215f?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "M.Sc. in Horticulture & Floriculture",
    experience: 6,
    specialization: "Crop selection",
    languages: ["Hindi", "English"],
    district: "Kanpur",
    state: "Uttar Pradesh",
    rating: 4.6,
    reviews: 98,
    visits: 310,
    consultationFee: 300,
    availability: "Online",
    responseTime: "within 15 minutes",
    bio: "Priya Sharma specializes in high-value cash crops, greenhouse horticulture, and polyhouse crop management. She offers detailed advice on selecting profitable flower, vegetable, and exotic fruit varieties.",
    education: "M.Sc. in Horticulture, Chandra Shekhar Azad University of Agriculture & Technology",
    certifications: ["Protected Cultivation Expert, ICAR", "Hydroponic Crop Care Practitioner"],
    latitude: 26.4499,
    longitude: 80.3319
  },
  {
    id: 6,
    name: "Mr. Ramdas Solanki",
    photo: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&h=300&q=80",
    qualification: "B.Sc. in Agriculture & Rural Development",
    experience: 7,
    specialization: "Government schemes",
    languages: ["Hindi"],
    district: "Sehore",
    state: "Madhya Pradesh",
    rating: 4.5,
    reviews: 120,
    visits: 430,
    consultationFee: 250,
    availability: "Offline",
    responseTime: "within 4 hours",
    bio: "Ramdas Solanki is dedicated to helping smallholder farmers navigate bank subsidies, crop insurance, and state/central government agricultural benefits (such as PM-KISAN and sub-mission on agricultural mechanization).",
    education: "B.Sc. in Agriculture, Rajmata Vijayaraje Scindia Krishi Vishwavidyalaya, Gwalior",
    certifications: ["Rural Extension Officer Certification", "Agri-Clinic & Agri-Business Center (ACABC) Graduate"],
    latitude: 23.2010,
    longitude: 77.0877
  }
];
