// Shared types and helpers used by the server, rider app, driver app and admin panel.

export const VEHICLE_TYPES = ['bike', 'rickshaw', 'mini', 'ac', 'vip'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_LABEL: Record<VehicleType, { en: string; ur: string; seats: number; hint: string }> = {
  bike: { en: 'Bike', ur: 'بائیک', seats: 1, hint: 'Fastest in traffic' },
  rickshaw: { en: 'Rickshaw', ur: 'رکشہ', seats: 3, hint: 'Short city hops' },
  mini: { en: 'Mini', ur: 'منی', seats: 4, hint: 'Everyday car' },
  ac: { en: 'AC Car', ur: 'اے سی کار', seats: 4, hint: 'Cool and comfortable' },
  vip: { en: 'VIP', ur: 'وی آئی پی', seats: 4, hint: 'Premium sedan' },
};

// Orders are service-agnostic: a ride, a pick-and-drop (collect food or anything and bring it to me)
// and a parcel delivery all use the same booking, offer and dispatch flow.
export type ServiceType = 'ride' | 'pickup' | 'delivery';
export const SERVICE_TYPES: ServiceType[] = ['ride', 'pickup', 'delivery'];
export const SERVICE_LABEL: Record<ServiceType, { en: string; ur: string; short: string; hint: string; from: string; to: string }> = {
  ride: { en: 'Ride', ur: 'سواری', short: 'RD', hint: 'Go anywhere in the city', from: 'Pickup', to: 'Destination' },
  pickup: { en: 'Pick & Drop', ur: 'پک اینڈ ڈراپ', short: 'PD', hint: 'Food or anything collected and brought to you', from: 'Collect from', to: 'Bring to' },
  delivery: { en: 'Delivery', ur: 'ڈیلیوری', short: 'DL', hint: 'Send a parcel to someone in the city', from: 'Pick up from', to: 'Deliver to' },
};
/** Vehicles that can carry goods. Cars are for passengers only in Phase 1. */
export const GOODS_VEHICLES: VehicleType[] = ['bike', 'rickshaw', 'mini'];
export interface OrderMeta {
  item: string;
  notes?: string;
  receiverName?: string;
  receiverPhone?: string;
}
export const bookingNo = (service: ServiceType, id: number) => `SG-${SERVICE_LABEL[service].short}-${String(id).padStart(6, '0')}`;

export type OrderStatus = 'requested' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_driver';
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['requested', 'accepted', 'arrived', 'in_progress'];
export const ASSIGNED_ORDER_STATUSES: OrderStatus[] = ['accepted', 'arrived', 'in_progress'];

export const DOC_TYPES = [
  'profile_photo',
  'cnic_front',
  'cnic_back',
  'cnic_selfie',
  'licence_front',
  'licence_back',
  'vehicle_reg_front',
  'vehicle_reg_back',
  'vehicle_photo',
] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const REQUIRED_DOCS: DocType[] = [
  'profile_photo',
  'cnic_front',
  'cnic_back',
  'cnic_selfie',
  'licence_front',
  'licence_back',
  'vehicle_reg_front',
  'vehicle_photo',
];
export const DOC_LABEL: Record<DocType, string> = {
  profile_photo: 'Profile photo',
  cnic_front: 'CNIC front',
  cnic_back: 'CNIC back',
  cnic_selfie: 'Selfie with CNIC',
  licence_front: 'Driving licence front',
  licence_back: 'Driving licence back',
  vehicle_reg_front: 'Vehicle registration',
  vehicle_reg_back: 'Vehicle registration back',
  vehicle_photo: 'Vehicle photo',
};
export type DocStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalStatus = 'incomplete' | 'pending' | 'approved' | 'rejected';

export interface LatLng {
  lat: number;
  lng: number;
}
export interface Place extends LatLng {
  addr: string;
}

/** Accepts 03XXXXXXXXX, 3XXXXXXXXX, 923XXXXXXXXX, +923XXXXXXXXX (spaces and dashes ignored). */
export function normalizePhone(input: string): string | null {
  const d = (input ?? '').replace(/[\s\-()]/g, '');
  let n: string | null = null;
  if (/^\+923\d{9}$/.test(d)) n = d;
  else if (/^923\d{9}$/.test(d)) n = '+' + d;
  else if (/^03\d{9}$/.test(d)) n = '+92' + d.slice(1);
  else if (/^3\d{9}$/.test(d)) n = '+92' + d;
  return n;
}
export function formatPhone(p: string): string {
  const m = /^\+92(3\d{2})(\d{7})$/.exec(p);
  return m ? `+92 ${m[1]} ${m[2]}` : p;
}
/** Returns CNIC as 00000-0000000-0, or null. Accepts with or without dashes. */
export function normalizeCnic(input: string): string | null {
  const d = (input ?? '').replace(/[\s-]/g, '');
  return /^\d{13}$/.test(d) ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : null;
}
export function formatPKR(n: number | null | undefined): string {
  return 'Rs ' + Math.round(n ?? 0).toLocaleString('en-PK');
}

// ---------- DTOs ----------
export interface UserDto {
  id: number;
  avatarUrl: string | null;
  trips: number;
  memberSince: number | null;
  role: 'rider' | 'driver';
  phone: string;
  name: string | null;
  rating: number | null;
  wallet: number;
}

export interface VehicleDto {
  type: VehicleType;
  model: string | null;
  color: string | null;
  plate: string | null;
  year: number | null;
}

export interface DriverSummaryDto {
  id: number;
  name: string | null;
  avatarUrl?: string | null;
  phone?: string;
  rating: number | null;
  ratingCount: number;
  vehicle: VehicleDto;
  lat: number | null;
  lng: number | null;
  heading: number | null;
}

export interface OfferDto {
  id: number;
  orderId: number;
  price: number;
  matchesOffer: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'declined' | 'expired';
  createdAt: number;
  distanceM: number | null;
  etaS: number | null;
  driver: DriverSummaryDto;
}

export interface OrderDto {
  id: number;
  bookingNo: string;
  service: ServiceType;
  meta?: OrderMeta | null;
  status: OrderStatus;
  vehicleType: VehicleType;
  pickup: Place;
  drop: Place;
  distanceM: number;
  durationS: number;
  route: [number, number][];
  estFare: number;
  offeredFare: number;
  agreedFare: number | null;
  waitingCharge: number;
  finalFare: number | null;
  commission: number | null;
  cancelFee: number;
  paymentMethod: 'cash';
  paymentStatus: 'pending' | 'paid';
  pin?: string; // only for the rider (and admin)
  expiresAt: number | null;
  createdAt: number;
  acceptedAt: number | null;
  arrivedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  sos: boolean;
  driver?: DriverSummaryDto;
  rider?: { id: number; name: string | null; avatarUrl?: string | null; phone?: string; rating: number | null };
  offers?: OfferDto[];
  driverRating: number | null;
  riderRating: number | null;
}

/** What a driver sees for an open request. Rider details stay minimal until accepted. */
export interface RequestDto {
  id: number;
  bookingNo: string;
  service: ServiceType;
  item?: string | null;
  riderAvatarUrl?: string | null;
  vehicleType: VehicleType;
  pickup: Place;
  drop: Place;
  distanceM: number;
  durationS: number;
  pickupDistanceM: number | null;
  pickupEtaS: number | null;
  estFare: number;
  offeredFare: number;
  maxCounter: number;
  expiresAt: number;
  riderName: string | null;
  riderRating: number | null;
  route: [number, number][];
}

export interface EstimateDto {
  vehicleType: VehicleType;
  fare: number;
  minOffer: number;
  maxOffer: number;
  breakdown: { base: number; distance: number; time: number; peakMultiplier: number; minFareApplied: boolean };
}
export interface EstimateResponse {
  distanceM: number;
  durationS: number;
  route: [number, number][];
  routeSource: 'osrm' | 'estimate';
  estimates: EstimateDto[];
}

export interface DriverProfileDto {
  user: UserDto;
  profile: {
    cnic: string | null;
    licenceNo: string | null;
    vehicleType: VehicleType | null;
    plate: string | null;
    model: string | null;
    color: string | null;
    year: number | null;
  };
  approvalStatus: ApprovalStatus;
  reviewNote: string | null;
  online: boolean;
  documents: { type: DocType; status: DocStatus; reason: string | null }[];
}

export const SOCKET_EVENTS = {
  orderNew: 'order:new',
  orderGone: 'order:gone',
  orderUpdate: 'order:update',
  offerNew: 'offer:new',
  driverLocation: 'driver:location',
  driverStatus: 'driver:status',
  liveDriver: 'live:driver',
  liveOrder: 'live:order',
  sosNew: 'sos:new',
} as const;

export function fmtDuration(s: number): string {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
