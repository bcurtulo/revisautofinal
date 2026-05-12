export interface User {
  id: number;
  name: string;
  nickname?: string;
  email: string;
  birth_date?: string;
  country?: string;
  phone?: string;
  zip_code?: string;
  state?: string;
  city?: string;
  location: string; // Keep for backward compatibility or computed
  plan?: 'free' | 'plus' | 'premium';
  ai_messages_count?: number;
  last_ai_message_date?: string | null;
  /** Fim do período vigente da assinatura (Mercado Pago), quando disponível */
  subscription_period_end?: string | null;
  access_token?: string;
}

export interface MileageLog {
  id?: string;
  date: string;
  mileage: number;
  valor?: number | null;
  litros?: number | null;
}

export interface Vehicle {
  id: number;
  user_id: number;
  type: 'Carro' | 'Moto' | 'Bike';
  brand: string;
  model: string;
  year: number;
  current_mileage: number;
  last_service_date: string;
  nickname?: string;
  color?: string;
  mileage_history?: MileageLog[];
  status?: 'active' | 'archived';
  deleted_at?: string;
}

export interface MaintenanceLog {
  id: number;
  vehicle_id: number;
  type: 'Limpeza' | 'Mecânica' | 'Documentação';
  description: string;
  date: string;
  cost: number;
  photo_path?: string;
  provider?: string;
}

export interface FinancialRecord {
  id: number;
  vehicle_id: number;
  type: 'Imposto' | 'Multa' | 'Taxa';
  description: string;
  due_date: string;
  value: number;
  status: 'Pago' | 'Em aberto' | 'Atrasado';
  payment_date?: string;
  notes?: string;
}

export interface ChatSession {
  id: number;
  user_id: number;
  vehicle_id?: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  sender: 'user' | 'ai';
  content: string;
  timestamp: string;
}
