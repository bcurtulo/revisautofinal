import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Car, Bike, Zap, Wrench, Droplets, FileText, Plus, Activity, MessageSquare, MapPin, Calendar, Clock, Gauge, ChevronLeft, Hop as Home, Menu, Eye, EyeOff, Check, X, Search, Warehouse, ChevronDown, ChevronUp, Shield, Send, Globe, Type, Crown, Pencil, Paintbrush, Trash2, Archive, History, Settings, User as UserIcon, DollarSign, CalendarDays, Mail, ArrowLeft } from 'lucide-react';
import { Vehicle, MaintenanceLog, User, MileageLog, FinancialRecord, ChatSession, ChatMessage } from './types';
import { CAR_BRANDS, CAR_MODELS, MOTO_BRANDS, MOTO_MODELS, EBIKE_BRANDS, EBIKE_MODELS, OFFENSIVE_WORDS, VEHICLE_COLORS } from './constants';
import { translations } from './translations';
import {
  formatAppDate,
  formatAppCurrency,
  getDefaultDateFormatForLanguage,
  getDateFormatDisplay,
  CURRENCY_OPTIONS,
  type DateFormat,
} from './utils/format';

// Inline WhatsApp brand glyph. lucide-react omits brand logos for trademark
// reasons, so we ship a minimal SVG here to avoid adding a dependency.
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<'garage' | 'advisor' | 'menu' | 'preferences'>('garage');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [financialRecords, setFinancialRecords] = useState<FinancialRecord[]>([]);
  
  // Chat State
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatHistoryStartDate, setChatHistoryStartDate] = useState('');
  const [chatHistoryEndDate, setChatHistoryEndDate] = useState('');
  const [showVehicleHistory, setShowVehicleHistory] = useState(false);
  const [archivedVehicles, setArchivedVehicles] = useState<Vehicle[]>([]);
  
  // Delete Confirmation State
  const [showDeleteVehicleModal, setShowDeleteVehicleModal] = useState(false);
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const [chatSessionToDelete, setChatSessionToDelete] = useState<number | null>(null);
  
  // Edit Vehicle State
  const [isEditingVehicle, setIsEditingVehicle] = useState(false);
  const [customColor, setCustomColor] = useState('');
  const [otherColor, setOtherColor] = useState('');

  // Date Filter State
  const [showDateFilters, setShowDateFilters] = useState(false);

  // Auth State
  const [authScreen, setAuthScreen] = useState<'login' | 'register' | 'terms' | 'success' | 'app' | 'recover' | 'reset-password' | 'onboarding_preferences'>('login');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverMessage, setRecoverMessage] = useState('');
  const [recoverError, setRecoverError] = useState('');
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Detect password recovery link (URL hash contains type=recovery and access_token)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const token = params.get('access_token');
      if (token) {
        setResetToken(token);
        setAuthScreen('reset-password');
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }
    }

    const storedUser = localStorage.getItem('revis_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setAuthScreen('app');
        fetchVehicles(parsedUser.id);
      } catch (e) {
        console.error("Failed to parse stored user", e);
        localStorage.removeItem('revis_user');
      }
    }
  }, []);

  const [authForm, setAuthForm] = useState({ 
    name: '', 
    nickname: '',
    email: '', 
    password: '', 
    confirmPassword: '',
    birthDay: '',
    birthMonth: '',
    birthYear: '',
    country: 'Brasil (+55)',
    phone: '',
    zip_code: '',
    state: '',
    city: ''
  });
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authLangMenuOpen, setAuthLangMenuOpen] = useState(false);
  const authLangRef = useRef<HTMLDivElement>(null);

  // Terms State
  const [activeTermsTab, setActiveTermsTab] = useState<'terms' | 'privacy'>('terms');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [hasScrolledTerms, setHasScrolledTerms] = useState(false);
  const [hasScrolledPrivacy, setHasScrolledPrivacy] = useState(false);
  const termsContentRef = React.useRef<HTMLDivElement>(null);

  const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isBottom = scrollHeight - scrollTop <= clientHeight + 50;
    
    if (isBottom) {
      if (activeTermsTab === 'terms') setHasScrolledTerms(true);
      if (activeTermsTab === 'privacy') setHasScrolledPrivacy(true);
    }
  };

  // Constants
  const COUNTRIES = [
    "Brasil (+55)", "Estados Unidos (+1)", "Portugal (+351)", "Argentina (+54)", 
    "Uruguai (+598)", "Paraguai (+595)", "Chile (+56)", "Reino Unido (+44)", 
    "França (+33)", "Alemanha (+49)", "Itália (+39)", "Espanha (+34)", 
    "Japão (+81)", "China (+86)", "Canadá (+1)", "Austrália (+61)"
  ];
  
  const DAYS = Array.from({length: 31}, (_, i) => (i + 1).toString().padStart(2, '0'));
  const YEARS = Array.from({length: 100}, (_, i) => (new Date().getFullYear() - i).toString());

  // CEP Lookup
  const handleCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cleanCep = e.target.value.replace(/\D/g, '');
    if (authForm.country === 'Brasil (+55)' && cleanCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        if (res.ok) {
          const data = await res.json();
          if (!data.erro) {
            setAuthForm(prev => ({ ...prev, city: data.localidade, state: data.uf }));
          }
        }
      } catch (e) {
        console.error("Erro ao buscar CEP", e);
      }
    }
  };

  // Password Validation
  const validatePassword = (pass: string) => {
    const hasUpper = /[A-Z]/.test(pass);
    const hasLower = /[a-z]/.test(pass);
    const hasNumber = /[0-9]/.test(pass);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    const isValidLength = pass.length >= 10 && pass.length <= 20;
    return { hasUpper, hasLower, hasNumber, hasSpecial, isValidLength, isValid: hasUpper && hasLower && hasNumber && hasSpecial && isValidLength };
  };

  const validatePhone = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) return false;
    
    // Check for repeated numbers (e.g., 11111111111)
    if (/^(\d)\1+$/.test(cleanPhone)) return false;
    
    // Check for sequential numbers (e.g., 12345678901)
    const sequential = "01234567890123456789";
    if (sequential.includes(cleanPhone)) return false;
    
    return true;
  };

  const validateNickname = (nickname: string) => {
    if (!nickname) return true; // Optional
    const lowerNick = nickname.toLowerCase();
    
    // Check against offensive words
    for (const word of OFFENSIVE_WORDS) {
      if (lowerNick.includes(word)) return false;
    }
    return true;
  };

  const isAgeValid = () => {
    if (!authForm.birthYear || !authForm.birthMonth || !authForm.birthDay) return false;
    const today = new Date();
    const birthDate = new Date(parseInt(authForm.birthYear), parseInt(authForm.birthMonth) - 1, parseInt(authForm.birthDay));
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const isFormValid = () => {
    if (!authForm.name || !authForm.email || !authForm.birthDay || !authForm.birthMonth || !authForm.birthYear || !authForm.country) return false;
    if (!validatePassword(authForm.password).isValid) return false;
    if (authForm.password !== authForm.confirmPassword) return false;
    if (!isAgeValid()) return false;
    
    if (authForm.country === 'Brasil (+55)') {
      if (!authForm.phone || !authForm.zip_code || !authForm.city || !authForm.state) return false;
      if (!validatePhone(authForm.phone)) return false;
    } else {
      if (!authForm.city || !authForm.state) return false;
    }
    return true;
  };

  // Forms State
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showAddLog, setShowAddLog] = useState(false);
  const [showAddFinancial, setShowAddFinancial] = useState(false);
  const [expandedCards, setExpandedCards] = useState({ mileage: false, services: false, financial: false });
  const [showAddMileage, setShowAddMileage] = useState(false);
  const [newMileage, setNewMileage] = useState({ date: '', mileage: '' });
  const [isSubmittingVehicle, setIsSubmittingVehicle] = useState(false);
  const [isSubmittingLog, setIsSubmittingLog] = useState(false);
  const [isSubmittingFinancial, setIsSubmittingFinancial] = useState(false);
  const [isSubmittingMileage, setIsSubmittingMileage] = useState(false);
  const [isDeletingRecord, setIsDeletingRecord] = useState(false);

  // Edição via modal: id do registro em edição (null = modal está em modo "Criar")
  const [editingMileageLogId, setEditingMileageLogId] = useState<string | null>(null);
  const [editingMaintenanceLogId, setEditingMaintenanceLogId] = useState<number | null>(null);
  const [editingFinancialRecordId, setEditingFinancialRecordId] = useState<number | null>(null);

  // Visualização (read-only) via modal
  type ViewingRecord =
    | { kind: 'mileage'; data: MileageLog }
    | { kind: 'maintenance'; data: MaintenanceLog }
    | { kind: 'financial'; data: FinancialRecord };
  const [viewingRecord, setViewingRecord] = useState<ViewingRecord | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const openViewRecord = (rec: ViewingRecord) => {
    setViewingRecord(rec);
    setIsViewModalOpen(true);
  };
  const closeViewRecord = () => {
    setIsViewModalOpen(false);
    setViewingRecord(null);
  };

  // Filter and Pagination State
  const [mileageFilterDate, setMileageFilterDate] = useState(() => ({ start: new Date().toISOString().split('T')[0], end: new Date(new Date().getFullYear(), 11, 31).toISOString().split('T')[0] }));
  const [activeMileageFilter, setActiveMileageFilter] = useState<{start: string, end: string} | null>(null);
  const [mileageLimit, setMileageLimit] = useState(10);

  const [servicesFilterDate, setServicesFilterDate] = useState(() => ({ start: new Date().toISOString().split('T')[0], end: new Date(new Date().getFullYear(), 11, 31).toISOString().split('T')[0] }));
  const [activeServicesFilter, setActiveServicesFilter] = useState<{start: string, end: string} | null>(null);
  const [servicesLimit, setServicesLimit] = useState(10);

  const [financialFilterDate, setFinancialFilterDate] = useState(() => ({ start: new Date().toISOString().split('T')[0], end: new Date(new Date().getFullYear(), 11, 31).toISOString().split('T')[0] }));
  const [activeFinancialFilter, setActiveFinancialFilter] = useState<{start: string, end: string} | null>(null);
  const [financialLimit, setFinancialLimit] = useState(10);
  
  // Edit State
  const [editingMileageIndex, setEditingMileageIndex] = useState<number | null>(null);
  const [editedMileageItem, setEditedMileageItem] = useState<MileageLog | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editedServiceItem, setEditedServiceItem] = useState<MaintenanceLog | null>(null);
  const [editingFinancialId, setEditingFinancialId] = useState<number | null>(null);
  const [editedFinancialItem, setEditedFinancialItem] = useState<FinancialRecord | null>(null);
  
  // Profile Confirmation State
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  // Edit Confirmation State
  const [showEditConfirmation, setShowEditConfirmation] = useState(false);
  const [showCancelEditConfirmation, setShowCancelEditConfirmation] = useState(false);
  const [pendingAction, setPendingAction] = useState<'saveMileage' | 'saveService' | 'saveFinancial' | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  // Add Vehicle Confirmation State
  const [showCancelAddVehicleConfirmation, setShowCancelAddVehicleConfirmation] = useState(false);

  const handleCancelAddVehicle = () => {
    setShowCancelAddVehicleConfirmation(true);
  };

  const handleConfirmCancelAddVehicle = () => {
    setShowCancelAddVehicleConfirmation(false);
    setShowAddVehicle(false);
  };
  
  // Preferences State
  const [language, setLanguage] = useState(() => localStorage.getItem('revis_language') || 'Português (Brasil)');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('revis_theme') as 'dark' | 'light') || 'dark');
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('revis_fontSize') || '2')); // 0 to 4

  // i18n: data + moeda globais
  const [dateFormat, setDateFormat] = useState<DateFormat>(() => {
    const stored = localStorage.getItem('revis_date_format');
    if (stored === 'dd/mm/yyyy' || stored === 'mm/dd/yyyy') return stored;
    const lang = localStorage.getItem('revis_language') || 'Português (Brasil)';
    return getDefaultDateFormatForLanguage(lang);
  });
  const [hasManualDateFormat, setHasManualDateFormat] = useState<boolean>(
    () => localStorage.getItem('revis_has_manual_date_format') === 'true',
  );
  const [currency, setCurrency] = useState<string>(() => localStorage.getItem('revis_currency') || 'BRL');

  // Temp Preferences State
  const [tempLanguage, setTempLanguage] = useState(language);
  const [tempTheme, setTempTheme] = useState(theme);
  const [tempFontSize, setTempFontSize] = useState(fontSize);
  const [tempDateFormat, setTempDateFormat] = useState<DateFormat>(dateFormat);
  const [tempCurrency, setTempCurrency] = useState<string>(currency);

  // Snapshot original ao entrar em "Preferências" — usado pelo Cancelar
  // para reverter o que foi aplicado em modo imediato.
  const [originalLanguage, setOriginalLanguage] = useState(language);
  const [originalTheme, setOriginalTheme] = useState(theme);
  const [originalFontSize, setOriginalFontSize] = useState(fontSize);
  const [originalDateFormat, setOriginalDateFormat] = useState<DateFormat>(dateFormat);
  const [originalCurrency, setOriginalCurrency] = useState<string>(currency);
  const [originalHasManualDateFormat, setOriginalHasManualDateFormat] = useState<boolean>(hasManualDateFormat);

  const [showPreferencesSaveConfirmation, setShowPreferencesSaveConfirmation] = useState(false);
  const [showPreferencesCancelConfirmation, setShowPreferencesCancelConfirmation] = useState(false);

  // Sync temp/original state when entering preferences tab
  useEffect(() => {
    if (activeTab === 'preferences') {
      setTempLanguage(language);
      setTempTheme(theme);
      setTempFontSize(fontSize);
      setTempDateFormat(dateFormat);
      setTempCurrency(currency);
      setOriginalLanguage(language);
      setOriginalTheme(theme);
      setOriginalFontSize(fontSize);
      setOriginalDateFormat(dateFormat);
      setOriginalCurrency(currency);
      setOriginalHasManualDateFormat(hasManualDateFormat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Aplica tema imediatamente (modo imediato)
  const applyThemeImmediate = (next: 'dark' | 'light') => {
    setTempTheme(next);
    setTheme(next);
  };

  // Aplica idioma imediatamente. Se o usuário ainda não escolheu manualmente
  // um formato de data, ajustamos automaticamente para casar com o idioma.
  const applyLanguageImmediate = (next: string) => {
    setTempLanguage(next);
    setLanguage(next);
    if (!hasManualDateFormat) {
      const auto = getDefaultDateFormatForLanguage(next);
      setDateFormat(auto);
      setTempDateFormat(auto);
    }
  };

  // Aplica tamanho da fonte imediatamente
  const applyFontSizeImmediate = (next: number) => {
    setTempFontSize(next);
    setFontSize(next);
  };

  // Aplica formato de data imediatamente (escolha manual: trava o auto-derive).
  const applyDateFormatImmediate = (next: DateFormat) => {
    setTempDateFormat(next);
    setDateFormat(next);
    setHasManualDateFormat(true);
  };

  // Aplica moeda imediatamente.
  const applyCurrencyImmediate = (next: string) => {
    setTempCurrency(next);
    setCurrency(next);
  };

  // AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Apply theme and font size
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.setProperty('--color-bg', '#181a1c');
      root.style.setProperty('--color-text', '#c7c7c7');
      root.style.setProperty('--color-card', '#4c4c4c');
      root.style.setProperty('--color-heading', '#ffffff');
    } else {
      root.classList.remove('dark');
      root.style.setProperty('--color-bg', '#f3f4f6'); // gray-100
      root.style.setProperty('--color-text', '#000000'); // black for better visibility
      root.style.setProperty('--color-card', '#ffffff');
      root.style.setProperty('--color-heading', '#000000'); // black
    }

    // Font size scaling
    const sizes = ['12px', '14px', '16px', '18px', '20px'];
    root.style.fontSize = sizes[fontSize];

    // Persist preferences
    localStorage.setItem('revis_theme', theme);
    localStorage.setItem('revis_fontSize', fontSize.toString());
    localStorage.setItem('revis_language', language);
    localStorage.setItem('revis_date_format', dateFormat);
    localStorage.setItem('revis_has_manual_date_format', hasManualDateFormat ? 'true' : 'false');
    localStorage.setItem('revis_currency', currency);

  }, [theme, fontSize, language, dateFormat, hasManualDateFormat, currency]);

  const t = (key: keyof typeof translations['Português (Brasil)']) => {
    // @ts-ignore
    return translations[language]?.[key] || translations['Português (Brasil)'][key];
  };

  const authLangOptions: { code: string; value: keyof typeof translations }[] = [
    { code: 'EN', value: 'English' },
    { code: 'PT-BR', value: 'Português (Brasil)' },
    { code: 'PT-PT', value: 'Português (Portugal)' },
    { code: 'ES', value: 'Español' },
  ];

  useEffect(() => {
    if (!authLangMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (authLangRef.current && !authLangRef.current.contains(e.target as Node)) {
        setAuthLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [authLangMenuOpen]);

  const renderAuthLanguageSelector = () => (
    <div className="absolute top-6 left-6 z-20" ref={authLangRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setAuthLangMenuOpen((o) => !o)}
          className="p-2 rounded-full bg-revis-dark-gray text-revis-green hover:bg-revis-gray/20 transition-colors"
          aria-expanded={authLangMenuOpen}
          aria-label={t('language')}
          aria-haspopup="listbox"
        >
          <Globe className="w-5 h-5" />
        </button>
        {authLangMenuOpen && (
          <div
            className="absolute left-0 mt-2 min-w-[7.5rem] rounded-xl border border-revis-dark-gray/80 bg-revis-black py-1 shadow-lg"
            role="listbox"
          >
            {authLangOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={language === opt.value}
                onClick={() => {
                  setLanguage(opt.value);
                  setAuthLangMenuOpen(false);
                }}
                className={`flex w-full items-center px-4 py-2 text-left text-xs font-semibold tracking-wide transition-colors hover:bg-revis-dark-gray ${
                  language === opt.value ? 'text-revis-green' : 'text-revis-light-gray'
                }`}
              >
                {opt.code}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  type TransKey = keyof typeof translations['Português (Brasil)'];

  const mapAuthErrorMessage = (raw: string | undefined): string => {
    if (raw == null || !String(raw).trim()) return t('serverError');
    const m = String(raw).trim();
    const lower = m.toLowerCase();

    if (raw === 'PROFILE_NOT_FOUND' || lower === 'profile_not_found') return t('profileNotFound');
    if (lower.includes('verifique seu e-mail') || lower.includes('email not confirmed')) return t('emailNotConfirmed');
    if (
      lower.includes('e-mail ou senha incorretos') ||
      lower.includes('incorrect email or password') ||
      lower.includes('correo o contraseña incorrectos') ||
      lower.includes('invalid login credentials') ||
      lower.includes('invalid credentials')
    )
      return t('invalidCredentials');

    if (
      lower.includes('already been registered') ||
      lower.includes('already registered') ||
      lower.includes('user already registered') ||
      lower.includes('email address is already') ||
      lower.includes('already exists') ||
      lower.includes('duplicate key') ||
      lower.includes('already been taken')
    )
      return t('emailAlreadyInUse');

    if (lower.includes('erro ao criar conta') || lower.includes('erro interno no servidor')) return t('serverError');
    if (
      lower.includes('erro interno do servidor') ||
      lower.includes('invalid server response') ||
      lower.includes('server response was not json')
    )
      return t('internalServerError');
    if (lower.includes('failed to fetch') || lower === 'networkerror' || lower.includes('network request failed'))
      return t('connectionError');

    if (lower.includes('password') && lower.includes('at least') && lower.includes('6')) return t('resetPasswordTooShort');

    return t('serverError');
  };

  // Mapeador inteligente: lê details (Supabase/Postgres) e message (app),
  // traduz para uma mensagem amigável e localizada.
  const mapAuthError = (errorData: { details?: unknown; message?: unknown } | null | undefined): string => {
    const details = typeof errorData?.details === 'string' ? errorData.details : '';
    const message = typeof errorData?.message === 'string' ? errorData.message : '';
    const haystack = `${details}\n${message}`.toLowerCase();

    if (
      haystack.includes('already been registered') ||
      haystack.includes('already registered') ||
      haystack.includes('user already registered') ||
      haystack.includes('email address is already') ||
      haystack.includes('already exists') ||
      haystack.includes('duplicate key') ||
      haystack.includes('email_exists')
    ) {
      return t('errorEmailAlreadyRegistered');
    }

    if (
      (haystack.includes('password') && haystack.includes('at least')) ||
      haystack.includes('weak_password') ||
      haystack.includes('password should be at least') ||
      haystack.includes('senha deve ter')
    ) {
      return t('errorPasswordTooShort');
    }

    if (
      haystack.includes('violates not-null') ||
      haystack.includes('null value in column') ||
      haystack.includes('not null constraint')
    ) {
      return t('errorRequiredFieldsMissing');
    }

    // Fallback: usa o mapeador legado da auth (cobre invalidCredentials, profileNotFound, etc.)
    const legacy = mapAuthErrorMessage(message || details);
    if (legacy && legacy !== t('serverError')) return legacy;

    return message || details || t('serverError');
  };

  const MONTHS = React.useMemo(() => {
    const keys: TransKey[] = [
      'monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun',
      'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec',
    ];
    const vals = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;
    return vals.map((val, i) => ({ val, label: t(keys[i]) }));
  }, [language]);

  const handleNativePurchase = async () => {
    if (!user) return;

    setIsUpgrading(true);

    setTimeout(() => {
      alert(t('revenueCatSimulation'));

      const updatedUser = { ...user, plan: 'premium' as const };
      setUser(updatedUser);
      localStorage.setItem('revis_user', JSON.stringify(updatedUser));

      setIsUpgrading(false);
      setShowUpgradeModal(false);
    }, 1500);
  };

  // New Vehicle State
  const [newVehicle, setNewVehicle] = useState<Partial<Vehicle>>(() => ({
    type: 'Carro',
    brand: '',
    model: '',
    year: new Date().getFullYear(),
    current_mileage: 0,
    last_service_date: new Date().toISOString().split('T')[0]
  }));
  const [customBrand, setCustomBrand] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [mileageInput, setMileageInput] = useState('');

  // New Log State
  const [newLog, setNewLog] = useState<Partial<MaintenanceLog>>(() => ({
    type: 'Mecânica',
    description: '',
    date: new Date().toISOString().split('T')[0],
    cost: 0,
    provider: ''
  }));

  // New Financial Record State
  const [newFinancial, setNewFinancial] = useState<Partial<FinancialRecord>>(() => ({
    type: 'Imposto',
    description: '',
    due_date: new Date().toISOString().split('T')[0],
    value: 0,
    status: 'Em aberto',
    payment_date: '',
    notes: ''
  }));

  // Profile State
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Support modal
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportMethod, setSupportMethod] = useState<'email' | 'whatsapp' | null>(null);
  const closeSupportModal = () => {
    setIsSupportModalOpen(false);
    setSupportMethod(null);
  };
  const [profileForm, setProfileForm] = useState({
    nickname: '',
    email: '',
    phone: '',
    zip_code: '',
    city: '',
    state: ''
  });

  useEffect(() => {
    if (user) {
      setProfileForm({
        nickname: user.nickname || '',
        email: user.email,
        phone: user.phone || '',
        zip_code: user.zip_code || '',
        city: user.city || '',
        state: user.state || ''
      });
    }
  }, [user]);

  // Body Scroll Lock for Modals
  useEffect(() => {
    if (showChatHistory || showVehicleHistory || showProfileEdit || showTermsModal || showPrivacyModal || showAddVehicle || showAddLog || showAddFinancial || showAddMileage || isSupportModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showChatHistory, showVehicleHistory, showProfileEdit, showTermsModal, showPrivacyModal, showAddVehicle, showAddLog, showAddFinancial, showAddMileage, isSupportModalOpen]);

  const handleProfileCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cleanCep = e.target.value.replace(/\D/g, '');
    if (cleanCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        if (res.ok) {
          const data = await res.json();
          if (!data.erro) {
            setProfileForm(prev => ({ ...prev, city: data.localidade, state: data.uf }));
          }
        }
      } catch (e) {
        console.error("Erro ao buscar CEP", e);
      }
    }
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSaveConfirmation(true);
  };

  const confirmSaveProfile = () => {
    setUser(prev => prev ? ({ ...prev, ...profileForm }) : null);
    setShowSaveConfirmation(false);
    setShowProfileEdit(false);
  };

  const handleCancelProfile = () => {
    setShowCancelConfirmation(true);
  };

  const confirmCancelProfile = () => {
    setShowCancelConfirmation(false);
    setShowProfileEdit(false);
    // Reset form to user data
    if (user) {
      setProfileForm({
        nickname: user.nickname || '',
        email: user.email,
        phone: user.phone || '',
        zip_code: user.zip_code || '',
        city: user.city || '',
        state: user.state || ''
      });
    }
  };

  // Edit Handlers
  const handleSaveMileage = (index: number, newItem: MileageLog) => {
    setPendingAction('saveMileage');
    setPendingIndex(index);
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleSaveService = (newItem: MaintenanceLog) => {
    setPendingAction('saveService');
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleSaveFinancial = (newItem: FinancialRecord) => {
    setPendingAction('saveFinancial');
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleConfirmSave = () => {
    if (pendingAction === 'saveMileage' && selectedVehicle && pendingIndex !== null) {
      const updatedHistory = [...(selectedVehicle.mileage_history || [])];
      updatedHistory[pendingIndex] = pendingPayload;
      updatedHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const updatedVehicle = { ...selectedVehicle, mileage_history: updatedHistory };
      const maxMileage = Math.max(...updatedHistory.map(l => l.mileage), 0);
      updatedVehicle.current_mileage = maxMileage;
      
      const updatedVehicles = vehicles.map(v => v.id === updatedVehicle.id ? updatedVehicle : v);
      setVehicles(updatedVehicles);
      setSelectedVehicle(updatedVehicle);
      
      setEditingMileageIndex(null);
      setEditedMileageItem(null);
    } else if (pendingAction === 'saveService') {
      setLogs(prevLogs => prevLogs.map(log => log.id === pendingPayload.id ? pendingPayload : log));
      setEditingServiceId(null);
      setEditedServiceItem(null);
    } else if (pendingAction === 'saveFinancial') {
      setFinancialRecords(prev => prev.map(rec => rec.id === pendingPayload.id ? pendingPayload : rec));
      setEditingFinancialId(null);
      setEditedFinancialItem(null);
    }
    setShowEditConfirmation(false);
    setPendingAction(null);
    setPendingPayload(null);
    setPendingIndex(null);
  };

  const handleCancelEdit = () => {
    setShowCancelEditConfirmation(true);
  };

  const handleConfirmCancel = () => {
    setEditingMileageIndex(null);
    setEditedMileageItem(null);
    setEditingServiceId(null);
    setEditedServiceItem(null);
    setEditingFinancialId(null);
    setEditedFinancialItem(null);
    setShowCancelEditConfirmation(false);
  };

  // ---- Helpers para os modais mistos (Criar/Editar) ----
  const openCreateMileage = () => {
    setEditingMileageLogId(null);
    setNewMileage({ date: new Date().toISOString().split('T')[0], mileage: '' });
    setShowAddMileage(true);
  };
  const openEditMileage = (log: MileageLog) => {
    if (!log.id) return; // mileage_logs gerados antes do schema novo podem não ter id
    const formatted = String(log.mileage ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    setEditingMileageLogId(log.id);
    setNewMileage({ date: log.date, mileage: formatted });
    setShowAddMileage(true);
  };
  const closeMileageModal = () => {
    setShowAddMileage(false);
    setEditingMileageLogId(null);
    setNewMileage({ date: '', mileage: '' });
  };

  const openCreateLog = () => {
    setEditingMaintenanceLogId(null);
    setNewLog({
      type: 'Mecânica',
      description: '',
      date: new Date().toISOString().split('T')[0],
      cost: 0,
      provider: '',
    });
    setShowAddLog(true);
  };
  const openEditLog = (log: MaintenanceLog) => {
    setEditingMaintenanceLogId(log.id);
    setNewLog({
      type: log.type,
      description: log.description,
      date: log.date,
      cost: log.cost,
      provider: log.provider ?? '',
      photo_path: log.photo_path,
    });
    setShowAddLog(true);
  };
  const closeLogModal = () => {
    setShowAddLog(false);
    setEditingMaintenanceLogId(null);
  };

  const openCreateFinancial = () => {
    setEditingFinancialRecordId(null);
    setNewFinancial({
      type: 'Imposto',
      description: '',
      due_date: new Date().toISOString().split('T')[0],
      value: 0,
      status: 'Em aberto',
      payment_date: '',
      notes: '',
    });
    setShowAddFinancial(true);
  };
  const openEditFinancial = (rec: FinancialRecord) => {
    setEditingFinancialRecordId(rec.id);
    setNewFinancial({
      type: rec.type,
      description: rec.description,
      due_date: rec.due_date,
      value: rec.value,
      status: rec.status,
      payment_date: rec.payment_date ?? '',
      notes: rec.notes ?? '',
    });
    setShowAddFinancial(true);
  };
  const closeFinancialModal = () => {
    setShowAddFinancial(false);
    setEditingFinancialRecordId(null);
  };

  useEffect(() => {
    if (selectedVehicle) {
      fetchLogs(selectedVehicle.id);
      fetchFinancialRecords(selectedVehicle.id);
      fetchMileageLogs(selectedVehicle.id);
    }
    // depende apenas do id para não entrar em loop quando o próprio fetchMileageLogs
    // hidrata selectedVehicle.mileage_history
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicle?.id]);

  useEffect(() => {
    // Check if terms content is already at bottom (e.g. short content)
    if (authScreen === 'terms' && termsContentRef.current) {
      const { scrollHeight, clientHeight } = termsContentRef.current;
      // If content fits without scrolling, mark as scrolled
      if (scrollHeight <= clientHeight + 50) {
        if (activeTermsTab === 'terms') setHasScrolledTerms(true);
        if (activeTermsTab === 'privacy') setHasScrolledPrivacy(true);
      }
    }
  }, [authScreen, activeTermsTab]);

  const fetchUser = async (userId?: string | number) => {
    const uid = userId ?? user?.id;
    if (uid == null || uid === '') return;
    try {
      const res = await fetch(`/api/user?userId=${encodeURIComponent(String(uid))}`);
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (e) {
      console.error("Failed to fetch user", e);
    }
  };

  const fetchVehicles = async (userId?: number) => {
    const uid = userId || user?.id;
    if (!uid) return;
    try {
      const res = await fetch(`/api/vehicles?userId=${uid}`);
      if (!res.ok) {
        console.error("Failed to fetch vehicles", res.status);
        alert(t('errorLoadingData'));
        return;
      }
      const raw = await res.json();
      const data: Vehicle[] = Array.isArray(raw) ? raw : [];
      setVehicles(data.filter(v => v.status !== 'archived'));
      setArchivedVehicles(data.filter(v => v.status === 'archived'));
    } catch (e) {
      console.error("Failed to fetch vehicles", e);
      alert(t('errorLoadingData'));
    }
    // Don't auto-select first vehicle on mobile to keep dashboard clean
  };

  const confirmArchiveVehicle = async () => {
    if (!selectedVehicle) return;
    
    try {
      const res = await fetch(`/api/vehicles/${selectedVehicle.id}/archive`, {
        method: 'POST'
      });
      
      if (!res.ok) {
        console.error("Failed to archive vehicle", res.status);
        alert(t('errorSavingData'));
        return;
      }
      const updatedVehicle = await res.json();
      setVehicles(prev => prev.filter(v => v.id !== selectedVehicle.id));
      setArchivedVehicles(prev => [...prev, updatedVehicle]);
      setSelectedVehicle(null);
      setActiveTab('garage');
      setShowDeleteVehicleModal(false);
    } catch (e) {
      console.error("Failed to archive vehicle", e);
      alert(t('errorSavingData'));
    }
  };

  const fetchLogs = async (vehicleId: number) => {
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/logs`);
      if (!res.ok) {
        console.error("Failed to fetch logs", res.status);
        alert(t('errorLoadingData'));
        return;
      }
      const raw = await res.json();
      setLogs(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.error("Failed to fetch logs", e);
      alert(t('errorLoadingData'));
    }
  };

  const fetchMileageLogs = async (vehicleId: number) => {
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/mileage`);
      if (!res.ok) {
        console.error("Failed to fetch mileage logs", res.status);
        alert(t('errorLoadingData'));
        return;
      }
      const raw = await res.json();
      const history: MileageLog[] = Array.isArray(raw) ? raw : [];
      setSelectedVehicle(prev => (prev && prev.id === vehicleId ? { ...prev, mileage_history: history } : prev));
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, mileage_history: history } : v));
    } catch (e) {
      console.error("Failed to fetch mileage logs", e);
      alert(t('errorLoadingData'));
    }
  };

  const fetchFinancialRecords = async (vehicleId: number) => {
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/financial`);
      if (!res.ok) {
        console.error("Failed to fetch financial records", res.status);
        alert(t('errorLoadingData'));
        return;
      }
      const raw = await res.json();
      setFinancialRecords(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.error("Failed to fetch financial records", e);
      alert(t('errorLoadingData'));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email, password: authForm.password })
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok || !data?.success) {
        console.error('Erro detalhado no login:', { status: res.status, data });
        setAuthError(mapAuthError(data));
        return;
      }

      setUser(data.user);
      localStorage.setItem('revis_user', JSON.stringify(data.user));
      setAuthScreen('app');
      fetchVehicles(data.user.id);
    } catch (err: any) {
      console.error('Erro detalhado no login (rede/JS):', err);
      setAuthError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    }
  };

  const handleRecoverPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoverError('');
    setRecoverMessage('');
    setRecoverLoading(true);
    try {
      const res = await fetch('/api/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) {
        console.error('Erro detalhado em recover-password:', { status: res.status, data });
        setRecoverError(mapAuthError(data));
      } else {
        setRecoverMessage(t('recoverEmailSent'));
      }
    } catch (err: any) {
      console.error('Erro detalhado em recover-password (rede/JS):', err);
      setRecoverError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    } finally {
      setRecoverLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    if (resetPassword !== resetConfirmPassword) {
      setResetError(t('passwordsDoNotMatch'));
      return;
    }
    if (resetPassword.length < 6) {
      setResetError(t('resetPasswordTooShort'));
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: resetToken, new_password: resetPassword })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) {
        console.error('Erro detalhado em reset-password:', { status: res.status, data });
        setResetError(mapAuthError(data));
        return;
      }
      setResetMessage(t('resetPasswordSuccess'));
      setTimeout(() => {
        setAuthScreen('login');
        setResetPassword('');
        setResetConfirmPassword('');
        setResetToken('');
        setResetMessage('');
      }, 2500);
    } catch (err: any) {
      console.error('Erro detalhado em reset-password (rede/JS):', err);
      setResetError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    } finally {
      setResetLoading(false);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!isAgeValid()) {
      setAuthError(t('registerMustBe18'));
      return;
    }
    
    if (authForm.country === 'Brasil (+55)' && !validatePhone(authForm.phone)) {
      setAuthError(t('invalidMobileBr'));
      return;
    }

    if (!validateNickname(authForm.nickname)) {
      setAuthError(t('nicknameNotAllowed'));
      return;
    }

    if (!isFormValid()) {
      setAuthError(t('fillAllFields'));
      return;
    }
    setAuthScreen('terms');
  };

  const confirmRegister = async () => {
    const birth_date = `${authForm.birthYear}-${authForm.birthMonth}-${authForm.birthDay}`;
    const payload = { ...authForm, birth_date };

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const errorData = await res.json().catch(() => ({} as any));

      if (!res.ok || !errorData?.success || !errorData?.user) {
        console.error('Erro detalhado no registro:', { status: res.status, errorData });
        setAuthError(mapAuthError(errorData));
        setAuthScreen('register');
        return;
      }

      setUser(errorData.user);
      localStorage.setItem('revis_user', JSON.stringify(errorData.user));
      fetchVehicles(errorData.user.id);
      setAuthScreen('onboarding_preferences');
    } catch (err: any) {
      console.error('Erro detalhado no registro (rede/JS):', err);
      setAuthError(mapAuthError({ message: err?.message }) || t('connectionError'));
      setAuthScreen('register');
    }
  };

  const handleMileageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    const mileage = parseInt(String(newMileage.mileage).replace(/\D/g, ''));
    if (Number.isNaN(mileage)) {
      alert(t('errorSavingData'));
      return;
    }

    setIsSubmittingMileage(true);
    try {
      const isEdit = !!editingMileageLogId;
      const url = isEdit
        ? `/api/vehicles/${selectedVehicle.id}/mileage/${editingMileageLogId}`
        : `/api/vehicles/${selectedVehicle.id}/mileage`;

      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mileage, date: newMileage.date })
      });
      if (!res.ok) {
        console.error('Error saving mileage:', res.status, await res.text().catch(() => ''));
        alert(t('errorSavingData'));
        return;
      }

      if (!isEdit) {
        setSelectedVehicle(prev => prev ? { ...prev, current_mileage: mileage } : prev);
        setVehicles(prev => prev.map(v => v.id === selectedVehicle.id ? { ...v, current_mileage: mileage } : v));
      }
      await fetchMileageLogs(selectedVehicle.id);

      setShowAddMileage(false);
      setEditingMileageLogId(null);
      setNewMileage({ date: '', mileage: '' });
    } catch (error) {
      console.error('Error saving mileage:', error);
      alert(t('errorSavingData'));
    } finally {
      setIsSubmittingMileage(false);
    }
  };

  const handleDeleteMileage = async () => {
    if (!selectedVehicle || !editingMileageLogId) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await fetch(`/api/vehicles/${selectedVehicle.id}/mileage/${editingMileageLogId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Error deleting mileage:', res.status, await res.text().catch(() => ''));
        alert(t('errorDeletingData'));
        return;
      }
      await fetchMileageLogs(selectedVehicle.id);
      // re-busca veículos para refletir current_mileage recalculado pelo backend
      await fetchVehicles(user?.id);
      setShowAddMileage(false);
      setEditingMileageLogId(null);
      setNewMileage({ date: '', mileage: '' });
    } catch (error) {
      console.error('Error deleting mileage:', error);
      alert(t('errorDeletingData'));
    } finally {
      setIsDeletingRecord(false);
    }
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const vehicleToSubmit = { ...newVehicle };
    
    // Handle Custom Brand
    if (vehicleToSubmit.brand === 'Outra') {
      vehicleToSubmit.brand = customBrand;
    }

    // Handle Custom Model (if brand is Outra or model is Outro)
    if (vehicleToSubmit.brand === 'Outra' || vehicleToSubmit.model === 'Outro') {
      vehicleToSubmit.model = customModel;
    }

    // Handle Color
    if (vehicleToSubmit.color === 'Customizado') {
      vehicleToSubmit.color = customColor;
    } else if (vehicleToSubmit.color === 'Outra') {
      vehicleToSubmit.color = otherColor;
    }

    setIsSubmittingVehicle(true);
    try {
      let res: Response;
      if (isEditingVehicle && selectedVehicle) {
        res = await fetch(`/api/vehicles/${selectedVehicle.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...vehicleToSubmit })
        });
      } else {
        res = await fetch('/api/vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...vehicleToSubmit, user_id: user?.id })
        });
      }

      if (!res.ok) {
        console.error("Failed to add/update vehicle", res.status);
        alert(t('errorSavingData'));
        return;
      }

      const data = await res.json();

      if (isEditingVehicle && selectedVehicle) {
        setVehicles(prev => prev.map(v => v.id === selectedVehicle.id ? { ...v, ...data } : v));
        setSelectedVehicle(prev => prev ? { ...prev, ...data } : null);
      } else {
        setVehicles(prev => [...prev, data]);
        setSelectedVehicle(data);
        setExpandedCards({ mileage: false, services: false, financial: false });
      }

      setActiveTab('garage');
      setShowAddVehicle(false);
      setIsEditingVehicle(false);
      setNewVehicle({
        type: 'Carro',
        brand: '',
        model: '',
        year: new Date().getFullYear(),
        current_mileage: 0,
        last_service_date: new Date().toISOString().split('T')[0],
        nickname: '',
        color: ''
      });
      setCustomBrand('');
      setCustomModel('');
      setCustomColor('');
      setOtherColor('');
    } catch (e) {
      console.error("Failed to add/update vehicle", e);
      alert(t('errorSavingData'));
    } finally {
      setIsSubmittingVehicle(false);
    }
  };

  const getBrandList = () => {
    if (newVehicle.type === 'Carro') return CAR_BRANDS;
    if (newVehicle.type === 'Moto') return MOTO_BRANDS;
    if (newVehicle.type === 'Bike') return EBIKE_BRANDS;
    return [];
  };

  const getModelList = () => {
    if (newVehicle.brand === 'Outra') return [];
    let models: string[] = [];
    if (newVehicle.type === 'Carro') models = CAR_MODELS[newVehicle.brand] || [];
    if (newVehicle.type === 'Moto') models = MOTO_MODELS[newVehicle.brand] || [];
    if (newVehicle.type === 'Bike') models = EBIKE_MODELS[newVehicle.brand] || [];
    return models.sort();
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setIsSubmittingLog(true);
    try {
      const isEdit = editingMaintenanceLogId !== null;
      const res = await fetch(
        isEdit
          ? `/api/vehicles/${selectedVehicle.id}/maintenance/${editingMaintenanceLogId}`
          : '/api/logs',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isEdit ? newLog : { ...newLog, vehicle_id: selectedVehicle.id }),
        },
      );
      if (!res.ok) {
        console.error('Failed to save log', res.status, await res.text().catch(() => ''));
        alert(t('errorSavingData'));
        return;
      }
      setShowAddLog(false);
      setEditingMaintenanceLogId(null);
      fetchLogs(selectedVehicle.id);
    } catch (err) {
      console.error('Failed to save log', err);
      alert(t('errorSavingData'));
    } finally {
      setIsSubmittingLog(false);
    }
  };

  const handleDeleteLog = async () => {
    if (!selectedVehicle || editingMaintenanceLogId === null) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await fetch(`/api/vehicles/${selectedVehicle.id}/maintenance/${editingMaintenanceLogId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Failed to delete log', res.status, await res.text().catch(() => ''));
        alert(t('errorDeletingData'));
        return;
      }
      await fetchLogs(selectedVehicle.id);
      setShowAddLog(false);
      setEditingMaintenanceLogId(null);
    } catch (err) {
      console.error('Failed to delete log', err);
      alert(t('errorDeletingData'));
    } finally {
      setIsDeletingRecord(false);
    }
  };

  const handleAddFinancial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setIsSubmittingFinancial(true);
    try {
      const isEdit = editingFinancialRecordId !== null;
      const res = await fetch(
        isEdit
          ? `/api/vehicles/${selectedVehicle.id}/financial/${editingFinancialRecordId}`
          : '/api/financial',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isEdit ? newFinancial : { ...newFinancial, vehicle_id: selectedVehicle.id }),
        },
      );
      if (!res.ok) {
        console.error('Failed to save financial record', res.status, await res.text().catch(() => ''));
        alert(t('errorSavingData'));
        return;
      }
      setShowAddFinancial(false);
      setEditingFinancialRecordId(null);
      fetchFinancialRecords(selectedVehicle.id);
    } catch (err) {
      console.error('Failed to save financial record', err);
      alert(t('errorSavingData'));
    } finally {
      setIsSubmittingFinancial(false);
    }
  };

  const handleDeleteFinancial = async () => {
    if (!selectedVehicle || editingFinancialRecordId === null) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await fetch(`/api/vehicles/${selectedVehicle.id}/financial/${editingFinancialRecordId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Failed to delete financial record', res.status, await res.text().catch(() => ''));
        alert(t('errorDeletingData'));
        return;
      }
      await fetchFinancialRecords(selectedVehicle.id);
      setShowAddFinancial(false);
      setEditingFinancialRecordId(null);
    } catch (err) {
      console.error('Failed to delete financial record', err);
      alert(t('errorDeletingData'));
    } finally {
      setIsDeletingRecord(false);
    }
  };

  // Chat Functions
  const fetchChatSessions = async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/chat/sessions?userId=${user.id}`);
      if (res.ok) {
        const raw = await res.json();
        const sessions = Array.isArray(raw) ? raw : [];
        setChatSessions(sessions.filter((s: ChatSession) => String(s.user_id) === String(user.id)));
      }
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
    }
  };

  const confirmDeleteChatSession = async () => {
    if (!chatSessionToDelete) return;
    
    try {
      const res = await fetch(`/api/chat/sessions/${chatSessionToDelete}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== chatSessionToDelete));
        if (currentSessionId === chatSessionToDelete) {
          setCurrentSessionId(null);
          setChatMessages([]);
        }
        setShowDeleteChatModal(false);
        setChatSessionToDelete(null);
      }
    } catch (error) {
      console.error("Error deleting chat session:", error);
    }
  };

  const loadChatSession = async (sessionId: number) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
      if (res.ok) {
        const raw = await res.json();
        setChatMessages(Array.isArray(raw) ? raw : []);
        setCurrentSessionId(sessionId);
        setShowChatHistory(false);
      }
    } catch (error) {
      console.error("Error loading chat session:", error);
    }
  };

  const createNewSession = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          vehicle_id: selectedVehicle?.id,
          title: selectedVehicle
            ? t('chatSessionAbout').replace('{brand}', selectedVehicle.brand).replace('{model}', selectedVehicle.model)
            : t('newChatSessionTitle')
        })
      });
      if (res.ok) {
        const { id } = await res.json();
        setCurrentSessionId(id);
        setChatMessages([]);
        fetchChatSessions();
        return id;
      }
    } catch (error) {
      console.error("Error creating chat session:", error);
    }
    return null;
  };

  const askAi = async () => {
    if (!aiPrompt.trim()) return;
    
    const userMessageText = aiPrompt;
    setAiPrompt(''); // Clear input immediately
    setIsLoadingAi(true);

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await createNewSession();
    }

    if (!sessionId) {
      setIsLoadingAi(false);
      return; // Failed to create session
    }

    // Add User Message to UI and DB
    const userMsg: ChatMessage = {
      id: Date.now(), // Temp ID
      session_id: sessionId,
      sender: 'user',
      content: userMessageText,
      timestamp: new Date().toISOString()
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          sender: 'user',
          content: userMessageText
        })
      });

      // SEGURANÇA: Prompt e Contexto movidos para o Backend
      // O Frontend envia apenas os identificadores e a mensagem do usuário
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessageText,
          vehicleId: selectedVehicle?.id,
          userId: user?.id
        })
      });
      
      const data = await response.json();
      const aiText = data.text || t('aiProcessingError');

      // Add AI Message to UI and DB
      const aiMsg: ChatMessage = {
        id: Date.now() + 1, // Temp ID
        session_id: sessionId,
        sender: 'ai',
        content: aiText,
        timestamp: new Date().toISOString()
      };
      setChatMessages(prev => [...prev, aiMsg]);

      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          sender: 'ai',
          content: aiText
        })
      });
      
      // Refresh sessions to update timestamp/order
      fetchChatSessions();

    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: Date.now() + 2,
        session_id: sessionId,
        sender: 'ai',
        content: t('aiConnectionError'),
        timestamp: new Date().toISOString()
      };
      setChatMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoadingAi(false);
    }
  };

  useEffect(() => {
    if (user && activeTab === 'advisor') {
      fetchChatSessions();
    }
  }, [user, activeTab]);

  const getHealthStatus = (vehicle: Vehicle) => {
    if (vehicle.current_mileage > 100000) return 'text-revis-alert-critical';
    if (vehicle.current_mileage > 50000) return 'text-revis-alert-medium';
    return 'text-revis-green';
  };

  // Footer Component
  const Footer = () => (
    <div className="mt-8 py-6 text-center border-t border-revis-dark-gray/50">
      <p className="text-xs text-revis-gray font-medium">{t('footerCopyright')}</p>
      <p className="text-xs text-revis-green mt-1">suporte@revisautoapp.com.br</p>
    </div>
  ); 

  // Mobile View Renderers
  const renderLogin = () => (
    <div className="flex flex-col min-h-screen p-6 bg-revis-black relative">
      {renderAuthLanguageSelector()}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="absolute top-6 right-6 px-4 py-2 rounded-full bg-revis-dark-gray text-revis-green hover:bg-revis-gray/20 transition-colors flex items-center gap-2 text-xs font-bold"
      >
        <span>{t('authTheme')}</span>
        <Paintbrush className="w-4 h-4" />
      </button>
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
        <div className="mb-8 text-center">
          <div className="bg-revis-green p-3 rounded-2xl inline-block mb-4">
            <Wrench className="w-8 h-8 text-black" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">
            <span className="text-revis-gray">Revis</span>
            <span className="text-revis-green">Auto</span>
          </h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
          <div>
            <label className="block text-xs text-revis-gray mb-1">{t('email')}</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
              value={authForm.email}
              onChange={e => setAuthForm({...authForm, email: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-xs text-revis-gray mb-1">{t('password')}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors pr-12"
                value={authForm.password}
                onChange={e => setAuthForm({...authForm, password: e.target.value})}
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-revis-gray"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* O botão 'Esqueci minha senha' agora está livre e visível */}
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={() => { setAuthError(''); setRecoverEmail(authForm.email); setRecoverError(''); setRecoverMessage(''); setAuthScreen('recover'); }}
              className="text-revis-green text-sm font-bold hover:underline"
            >
              {t('forgotPassword')}
            </button>
          </div>

          {authError && <p className="text-revis-alert-critical text-sm text-center mt-4">{authError}</p>}

          <button type="submit" className="w-full mt-6 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm">
            {t('loginButton')}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-revis-gray text-sm">{t('noAccount')}</p>
          <button onClick={() => { setAuthError(''); setAuthScreen('register'); }} className="text-revis-green font-bold mt-1">
            {t('registerTitle')}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );

  const renderRecover = () => (
    <div className="flex flex-col min-h-screen p-6 bg-revis-black">
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
        <div className="mb-8 text-center">
          <div className="bg-revis-dark-gray p-3 rounded-2xl inline-block mb-4">
            <Wrench className="w-8 h-8 text-revis-green" />
          </div>
          <h1 className="text-xl font-bold text-revis-heading mb-1">{t('forgotPassword')}</h1>
          <p className="text-sm text-revis-gray">{t('recoverInstructions')}</p>
        </div>

        {recoverMessage ? (
          <div className="bg-revis-green/10 border border-revis-green rounded-xl p-4 text-center">
            <Check className="w-8 h-8 text-revis-green mx-auto mb-2" />
            <p className="text-revis-green text-sm font-medium">{recoverMessage}</p>
            <button
              onClick={() => { setAuthScreen('login'); setRecoverMessage(''); }}
              className="mt-4 text-xs text-revis-gray hover:text-revis-green transition-colors"
            >
              {t('backToLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleRecoverPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-revis-gray mb-1">{t('email')}</label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                value={recoverEmail}
                onChange={e => setRecoverEmail(e.target.value)}
                placeholder={t('placeholderEmailExample')}
              />
            </div>

            {recoverError && <p className="text-revis-alert-critical text-sm text-center">{recoverError}</p>}

            <button
              type="submit"
              disabled={recoverLoading}
              className="w-full bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm disabled:opacity-60"
            >
              {recoverLoading ? t('sending') : t('sendRecoveryLink')}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => { setAuthScreen('login'); setRecoverError(''); setRecoverMessage(''); }}
            className="text-revis-gray text-sm hover:text-revis-green transition-colors flex items-center gap-1 mx-auto"
          >
            <ChevronLeft className="w-4 h-4" />
            {t('back')}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );

  const renderResetPassword = () => (
    <div className="flex flex-col min-h-screen p-6 bg-revis-black">
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
        <div className="mb-8 text-center">
          <div className="bg-revis-dark-gray p-3 rounded-2xl inline-block mb-4">
            <Shield className="w-8 h-8 text-revis-green" />
          </div>
          <h1 className="text-xl font-bold text-revis-heading mb-1">{t('newPassword')}</h1>
          <p className="text-sm text-revis-gray">{t('resetPasswordIntro')}</p>
        </div>

        {resetMessage ? (
          <div className="bg-revis-green/10 border border-revis-green rounded-xl p-4 text-center">
            <Check className="w-8 h-8 text-revis-green mx-auto mb-2" />
            <p className="text-revis-green text-sm font-medium">{resetMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-revis-gray mb-1">{t('newPasswordLabel')}</label>
              <input
                type="password"
                required
                className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder={t('placeholderPasswordMask')}
              />
            </div>
            <div>
              <label className="block text-xs text-revis-gray mb-1">{t('confirmPassword')}</label>
              <input
                type="password"
                required
                className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                value={resetConfirmPassword}
                onChange={e => setResetConfirmPassword(e.target.value)}
                placeholder={t('placeholderPasswordMask')}
              />
            </div>

            {resetError && <p className="text-revis-alert-critical text-sm text-center">{resetError}</p>}

            <button
              type="submit"
              disabled={resetLoading}
              className="w-full bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm disabled:opacity-60"
            >
              {resetLoading ? t('saving') : t('saveNewPassword')}
            </button>
          </form>
        )}
      </div>
      <Footer />
    </div>
  );

  const renderRegister = () => (
    <div className="flex flex-col min-h-screen p-6 bg-revis-black relative">
      {renderAuthLanguageSelector()}
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
      <h1 className="text-xl font-bold text-revis-heading mb-6 mt-2">{t('registerTitle')}</h1>

      <form onSubmit={handleRegister} className="space-y-5 flex-1" autoComplete="off">
        {/* 1. Nome Completo */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('name')}*</label>
          <input 
            required
            autoComplete="name"
            className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
            value={authForm.name}
            onChange={e => setAuthForm({...authForm, name: e.target.value})}
          />
        </div>

        {/* 2. Como quer ser chamado */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('nickname')}</label>
          <input 
            autoComplete="username"
            className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
            value={authForm.nickname}
            onChange={e => setAuthForm({...authForm, nickname: e.target.value})}
          />
          {!validateNickname(authForm.nickname) && authForm.nickname.length > 0 && (
             <p className="text-xs text-revis-alert-critical mt-1 ml-1">{t('nicknameNotAllowed')}</p>
          )}
        </div>

        {/* 3. E-mail */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('email')}*</label>
          <input 
            type="email"
            required
            autoComplete="email"
            className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
            value={authForm.email}
            onChange={e => setAuthForm({...authForm, email: e.target.value})}
          />
          <p className="text-[10px] text-revis-gray mt-1 ml-1">{t('registerEmailHint')}</p>
        </div>

        {/* 4. Data de Nascimento */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('birthDate')}*</label>
          <div className="grid grid-cols-3 gap-2">
            <select 
              required
              className="bg-revis-dark-gray rounded-xl p-3 text-sm text-revis-light-gray outline-none appearance-none"
              value={authForm.birthDay}
              onChange={e => setAuthForm({...authForm, birthDay: e.target.value})}
            >
              <option value="">{t('labelDay')}</option>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select 
              required
              className="bg-revis-dark-gray rounded-xl p-3 text-sm text-revis-light-gray outline-none appearance-none"
              value={authForm.birthMonth}
              onChange={e => setAuthForm({...authForm, birthMonth: e.target.value})}
            >
              <option value="">{t('labelMonth')}</option>
              {MONTHS.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
            </select>
            <select 
              required
              className="bg-revis-dark-gray rounded-xl p-3 text-sm text-revis-light-gray outline-none appearance-none"
              value={authForm.birthYear}
              onChange={e => setAuthForm({...authForm, birthYear: e.target.value})}
            >
              <option value="">{t('labelYear')}</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {!isAgeValid() && authForm.birthYear && (
             <p className="text-xs text-revis-alert-critical mt-1 ml-1">{t('ageRequirement18')}</p>
          )}
        </div>

        {/* 5. País */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('country')}*</label>
          <select 
            required
            className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none appearance-none"
            value={authForm.country}
            onChange={e => setAuthForm({...authForm, country: e.target.value})}
          >
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* 5.1 / 5.2 Condicionais */}
        {authForm.country === 'Brasil (+55)' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('zipCode')}*</label>
                <input 
                  required
                  placeholder={t('placeholderCepMask')}
                  maxLength={9}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                  value={authForm.zip_code}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2');
                    setAuthForm({...authForm, zip_code: val});
                  }}
                  onBlur={handleCepBlur}
                />
              </div>
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('phone')}*</label>
                <input 
                  required
                  placeholder={t('placeholderPhoneBrMask')}
                  maxLength={15}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                  value={authForm.phone}
                  onChange={e => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 11) val = val.slice(0, 11);
                    val = val.replace(/^(\d{2})(\d)/, '($1) $2');
                    val = val.replace(/(\d{5})(\d)/, '$1-$2');
                    setAuthForm({...authForm, phone: val});
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('city')}</label>
                <input 
                  readOnly
                  className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-3 text-sm text-revis-gray outline-none cursor-not-allowed"
                  value={authForm.city}
                />
              </div>
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('state')}</label>
                <input 
                  readOnly
                  className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-3 text-sm text-revis-gray outline-none cursor-not-allowed"
                  value={authForm.state}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs text-revis-gray mb-1">{t('phone')}</label>
              <input 
                className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                value={authForm.phone}
                onChange={e => {
                  const val = e.target.value.replace(/[^0-9()]/g, '');
                  setAuthForm({...authForm, phone: val});
                }}
              />
              {authForm.country === 'Brasil (+55)' && authForm.phone.length >= 10 && !validatePhone(authForm.phone) && (
                 <p className="text-xs text-revis-alert-critical mt-1 ml-1">{t('invalidMobileBr')}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('city')}</label>
                <input 
                  maxLength={25}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                  value={authForm.city}
                  onChange={e => {
                    const val = e.target.value.replace(/[^a-zA-Z\u00C0-\u00FF ]/g, '');
                    setAuthForm({...authForm, city: val});
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-revis-gray mb-1">{t('state')}</label>
                <input 
                  maxLength={25}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors"
                  value={authForm.state}
                  onChange={e => {
                    const val = e.target.value.replace(/[^a-zA-Z\u00C0-\u00FF ]/g, '');
                    setAuthForm({...authForm, state: val});
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* 6. Senha */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('password')}*</label>
          <div className="relative">
            <input 
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              maxLength={20}
              className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors pr-12"
              value={authForm.password}
              onChange={e => setAuthForm({...authForm, password: e.target.value})}
            />
            <button 
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-revis-gray"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          
          <div className="mt-2 grid grid-cols-1 gap-2">
            {[
              { label: t('passwordReqUpper'), valid: validatePassword(authForm.password).hasUpper },
              { label: t('passwordReqLower'), valid: validatePassword(authForm.password).hasLower },
              { label: t('passwordReqNumber'), valid: validatePassword(authForm.password).hasNumber },
              { label: t('passwordReqSpecial'), valid: validatePassword(authForm.password).hasSpecial },
              { label: t('passwordReqLength'), valid: validatePassword(authForm.password).isValidLength },
            ].map((req, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {req.valid ? (
                  <Check className="w-3 h-3 text-revis-green" />
                ) : (
                  <div className="w-3 h-3 rounded-full border border-revis-gray" />
                )}
                <span className={`text-[10px] ${req.valid ? 'text-revis-green' : 'text-revis-gray'}`}>
                  {req.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Repetir Senha */}
        <div>
          <label className="block text-xs text-revis-gray mb-1">{t('confirmPassword')}*</label>
          <div className="relative">
            <input 
              type={showConfirmPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              className={`w-full bg-revis-dark-gray border rounded-xl p-3 text-sm text-revis-light-gray outline-none transition-colors pr-12 ${
                authForm.confirmPassword && authForm.password !== authForm.confirmPassword 
                  ? 'border-revis-alert-critical focus:border-revis-alert-critical' 
                  : 'border-transparent focus:border-revis-green'
              }`}
              value={authForm.confirmPassword}
              onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})}
            />
            <button 
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-revis-gray"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {authForm.confirmPassword && authForm.password !== authForm.confirmPassword && (
            <p className="text-xs text-revis-alert-critical mt-1 ml-1">{t('passwordsDoNotMatch')}</p>
          )}
        </div>

        {authError && <p className="text-revis-alert-critical text-sm text-center">{authError}</p>}

        <div className="flex gap-4 pt-4 mt-auto">
          <button 
            type="button" 
            onClick={() => { setAuthError(''); setAuthScreen('login'); }}
            className="flex-1 bg-revis-dark-gray text-gray-500 font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors text-sm"
          >
            &lt; {t('back')}
          </button>
          <button 
            type="submit" 
            disabled={!isFormValid()}
            className="flex-1 bg-revis-green disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm"
          >
            {t('next')}
          </button>
        </div>
      </form>
      <Footer />
      </div>
    </div>
  );

  const renderTerms = () => (
    <div className="flex flex-col h-[100dvh] p-6 bg-revis-black">
      
      <div className="flex gap-4 mb-6 border-b border-revis-dark-gray">
        <button 
          onClick={() => {
            setActiveTermsTab('terms');
            if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
          }}
          className={`pb-2 px-2 font-medium transition-colors flex-1 text-sm ${activeTermsTab === 'terms' ? 'text-revis-green border-b-2 border-revis-green' : 'text-revis-gray'}`}
        >
          {t('terms')}
        </button>
        <button 
          onClick={() => {
            setActiveTermsTab('privacy');
            if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
          }}
          className={`pb-2 px-2 font-medium transition-colors flex-1 text-sm ${activeTermsTab === 'privacy' ? 'text-revis-green border-b-2 border-revis-green' : 'text-revis-gray'}`}
        >
          {t('privacy')}
        </button>
      </div>
      
      <div 
        ref={termsContentRef}
        onScroll={handleTermsScroll}
        className="flex-1 bg-revis-dark-gray rounded-xl p-4 overflow-y-auto mb-6 text-xs text-revis-light-gray space-y-4"
      >
        {activeTermsTab === 'privacy' ? (
          <>
            <h3 className="font-bold text-revis-heading mb-2 text-sm">POLÍTICA DE PRIVACIDADE – REVISAUTO</h3>
            <p className="text-[10px] text-revis-gray mb-4">Última atualização: 17 de fevereiro de 2026.<br/>*novas atualizações serão notificadas por e-mail para novo aceite</p>
            
            <p>A plataforma RevisAuto tem o compromisso de proteger a privacidade e os dados pessoais de seus usuários. Esta Política descreve como coletamos, usamos, armazenamos e protegemos suas informações, em total conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).</p>
            
            <h4 className="font-bold text-revis-gray mt-4 text-sm">1. DADOS COLETADOS</h4>
            <p>Para o funcionamento das funcionalidades de consultoria e manutenção, coletamos:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Informações de Cadastro: Nome, e-mail e data de nascimento (para verificação de maioridade).</li>
              <li>Informações do Veículo: Marca, modelo, ano, quilometragem e histórico de serviços inseridos.</li>
              <li>Dados de Localização: Coletamos sua localização aproximada (cidade) para fornecer alertas climáticos específicos (ex: maresia e umidade).</li>
              <li>Dados de Mídia: Fotos de recibos ou fotos do veículo enviadas pelo usuário através da função de câmera.</li>
            </ul>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">2. FINALIDADE DO TRATAMENTO DE DADOS</h4>
            <p>Os dados são utilizados exclusivamente para:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Personalizar as recomendações da Inteligência Artificial.</li>
              <li>Gerar alertas de manutenção preventiva e estética automotiva.</li>
              <li>Garantir a segurança da conta e prevenir fraudes.</li>
              <li>Melhorar a experiência na comunidade e rede social do app.</li>
            </ul>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">3. COMPARTILHAMENTO DE DADOS</h4>
            <p>3.1. Não Comercialização: O RevisAuto não vende seus dados pessoais a terceiros.</p>
            <p>3.2. Parceiros Técnicos: Seus dados podem ser processados em servidores de nuvem (Google Cloud) e através da API de Inteligência Artificial do Google, que seguem padrões internacionais de segurança.</p>
            <p>3.3. Ordens Judiciais: Poderemos compartilhar dados caso sejamos obrigados por lei ou decisão judicial, conforme o Marco Civil da Internet.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">4. SEGURANÇA DA INFORMAÇÃO</h4>
            <p>4.1. Criptografia: Utilizamos criptografia SSL/TLS para o tráfego de dados entre o seu celular e nossos servidores.</p>
            <p>4.2. Armazenamento Seguro: Os dados são armazenados em bancos de dados protegidos por firewalls e controles de acesso rigorosos.</p>
            <p>4.3. Responsabilidade do Usuário: A segurança também depende de você. Mantenha sua senha em sigilo e não utilize o app em redes Wi-Fi públicas não seguras.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">5. SEUS DIREITOS (LGPD)</h4>
            <p>Como titular dos dados, você tem o direito de:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Confirmar a existência de tratamento de seus dados.</li>
              <li>Acessar seus dados a qualquer momento.</li>
              <li>Corrigir dados incompletos ou desatualizados.</li>
              <li>Portabilidade: Solicitar a exportação de seus dados para outros serviços.</li>
              <li>Exclusão (Direito ao Esquecimento): Solicitar a eliminação definitiva de todos os seus dados dos nossos servidores através das configurações do app.</li>
            </ul>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">6. COOKIES E TECNOLOGIAS DE RASTREIO</h4>
            <p>Utilizamos identificadores de dispositivos móveis para reconhecer seu aparelho e manter sua sessão ativa, além de ferramentas de análise (como Google Analytics) para entender como os usuários interagem com o app e melhorar as funcionalidades.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">7. RETENÇÃO DE DADOS</h4>
            <p>Mantemos seus dados apenas pelo tempo necessário para cumprir as finalidades descritas nesta política ou conforme exigido por obrigações legais de guarda de registros (Marco Civil da Internet).</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">8. CONTATO E ENCARREGADO DE DADOS (DPO)</h4>
            <p>Para exercer seus direitos ou tirar dúvidas sobre sua privacidade, entre em contato com nosso Encarregado de Proteção de Dados (DPO) através do e-mail oficial: suporte@revisautoapp.com.br.</p>
          </>
        ) : (
          <>
            <h3 className="font-bold text-revis-gray mb-2 text-sm">TERMOS E CONDIÇÕES DE USO – PLATAFORMA REVISAUTO</h3>
            <p className="text-[10px] text-revis-gray mb-4">Última atualização: 17 de fevereiro de 2026.<br/>*novas atualizações serão notificadas por e-mail para novo aceite</p>
            
            <div className="bg-revis-alert-medium/10 border border-revis-alert-medium p-3 rounded-lg mb-4">
              <p className="text-revis-alert-medium font-bold text-[10px]">AVISO DE MAIORIDADE</p>
              <p className="text-[10px] mt-1">O RevisAuto é uma plataforma destinada exclusivamente a usuários maiores de 18 (dezoito) anos. Ao acessar ou utilizar este aplicativo, você declara possuir a idade mínima exigida e plena capacidade civil, compreendendo que a gestão e condução de veículos automotores e elétricos no Brasil requerem maioridade e habilitação legal específica.</p>
            </div>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">1. CADASTRO E SEGURANÇA DE DADOS (CONFORMIDADE LGPD)</h4>
            <p>1.1. Elegibilidade: O Usuário declara ser maior de 18 anos e ser o proprietário ou possuidor legítimo do veículo cadastrado.</p>
            <p>1.2. Veracidade das Informações: O Usuário é o único responsável pela precisão e atualização dos dados inseridos (quilometragem, datas de manutenção, histórico de reparos).</p>
            <p>1.3. Confidencialidade: As credenciais de acesso são pessoais e intransferíveis. O Usuário compromete-se a notificar a administração do RevisAuto imediatamente sobre qualquer uso não autorizado de sua conta.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">2. COMUNIDADE E REDE SOCIAL (DIRETRIZES DE CONDUTA)</h4>
            <p>2.1. Conteúdo Gerado pelo Usuário (UGC): O Usuário concede ao RevisAuto uma licença gratuita e global para exibir conteúdos postados em áreas comuns do app.</p>
            <p>2.2. Proibições: É proibida a publicação de conteúdo difamatório, obsceno, abusivo, ilegal ou propaganda não autorizada (SPAM).</p>
            <p>2.3. Moderação: O RevisAuto reserva-se o direito de remover conteúdos e banir usuários que violem estas diretrizes.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">3. PROPRIEDADE INTELECTUAL E PROTEÇÃO CONTRA PLÁGIO</h4>
            <p>3.1. Propriedade e Patenteamento: Todo o código-fonte, interface gráfica, algoritmos de IA e a marca RevisAuto são de propriedade exclusiva da desenvolvedora, protegidos por registro de software e patentes conforme aplicável.</p>
            <p>3.2. Proibição de Plágio: É terminantemente proibida a reprodução total ou parcial da lógica ou design da plataforma.</p>
            <p>3.3. Procedimentos Judiciais: A prática de plágio sujeitará o infrator a procedimentos judiciais nas esferas cível e criminal, incluindo indenizações por danos materiais e lucros cessantes.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">4. PROTOCOLOS DE SEGURANÇA E PREVENÇÃO A FRAUDES</h4>
            <p>4.1. Cuidado com Credenciais: O RevisAuto jamais solicitará sua senha de acesso por telefone, e-mail, SMS ou redes sociais. O compartilhamento de senhas com terceiros é de inteira responsabilidade do Usuário.</p>
            <p>4.2. Canais Oficiais de Cobrança: Todas as transações financeiras e cobranças de assinaturas são realizadas exclusivamente através de plataformas verificadas e integradas (App Store, Google Play ou gateways de pagamento seguros dentro do app).</p>
            <p>4.3. Alertas de Golpes: O RevisAuto não realiza cobranças nem solicita pagamentos via WhatsApp, ligações telefônicas, SMS ou links diretos enviados por e-mail. Caso receba solicitações de transferência (PIX, boletos ou cartões) fora do ambiente seguro do aplicativo, o Usuário deve ignorar e reportar o incidente.</p>
            <p>4.4. Isenção de Responsabilidade por Engenharia Social: O RevisAuto não se responsabiliza por prejuízos financeiros decorrentes de golpes de terceiros, phishing ou transferências realizadas pelo usuário para contas não oficiais.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">5. ASSINATURAS E PAGAMENTOS</h4>
            <p>5.1. Serviços Premium: Funcionalidades pagas estarão sujeitas a termos de recorrência apresentados no momento da contratação.</p>
            <p>5.2. Reajustes: Alterações de valores serão comunicadas com 30 (trinta) dias de antecedência.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">6. DISPONIBILIDADE E MODIFICAÇÕES</h4>
            <p>6.1. Interrupções de Serviço: O serviço pode sofrer instabilidades técnicas devido a provedores de nuvem terceiros.</p>
            <p>6.2. Alteração dos Termos: A continuidade do uso do app após atualizações constitui aceitação dos novos termos.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">7. NATUREZA DO SERVIÇO E ISENÇÃO DE RESPONSABILIDADE</h4>
            <p>7.1. Consultoria via IA: O Usuário reconhece que o RevisAuto fornece recomendações geradas por algoritmos com caráter meramente informativo e consultivo.</p>
            <p>7.2. Responsabilidade Técnica: A plataforma não substitui o manual do fabricante ou a avaliação de um profissional. O RevisAuto não se responsabiliza por danos decorrentes da aplicação de sugestões da IA.</p>
            <p>7.3. Dicas de Produtos: A compatibilidade de produtos químicos ou peças é de inteira responsabilidade do Usuário.</p>

            <h4 className="font-bold text-revis-gray mt-4 text-sm">8. FORO E LEGISLAÇÃO APLICÁVEL</h4>
            <p>8.1. Regido pelas leis da República Federativa do Brasil (Marco Civil da Internet e LGPD).</p>
            <p>8.2. Eleito o Foro da Comarca de Vila Velha, Estado do Espírito Santo.</p>
          </>
        )}
      </div>

      <div className="space-y-3 mb-6">
        <label className={`flex items-center gap-3 cursor-pointer transition-opacity duration-300 ${hasScrolledTerms ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${acceptedTerms ? 'bg-revis-green border-revis-green' : 'border-revis-gray'}`}>
            {acceptedTerms && <Check className="w-3 h-3 text-black" />}
          </div>
          <input
            type="checkbox"
            className="hidden"
            checked={acceptedTerms}
            onChange={() => {
              const next = !acceptedTerms;
              setAcceptedTerms(next);
              // Ao aceitar os Termos, leva o usuário automaticamente para a Política de Privacidade.
              if (next && activeTermsTab === 'terms') {
                setActiveTermsTab('privacy');
                if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
              }
            }}
          />
          <span className="text-xs text-revis-light-gray">{t('readAndAcceptTerms')} <span className="text-revis-green font-bold">{t('terms')}</span></span>
        </label>
        
        <label className={`flex items-center gap-3 cursor-pointer transition-opacity duration-300 ${hasScrolledPrivacy ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${acceptedPrivacy ? 'bg-revis-green border-revis-green' : 'border-revis-gray'}`}>
            {acceptedPrivacy && <Check className="w-3 h-3 text-black" />}
          </div>
          <input type="checkbox" className="hidden" checked={acceptedPrivacy} onChange={() => setAcceptedPrivacy(!acceptedPrivacy)} />
          <span className="text-xs text-revis-light-gray">{t('readAndAcceptPrivacy')} <span className="text-revis-green font-bold">{t('privacy')}</span></span>
        </label>
      </div>
      
      {((activeTermsTab === 'terms' && !hasScrolledTerms) || (activeTermsTab === 'privacy' && !hasScrolledPrivacy)) && (
        <p className="text-[11px] text-center text-revis-alert-medium font-bold mb-2 animate-pulse">{t('scrollDown')}</p>
      )}

      <div className="flex gap-4">
        <button 
          onClick={() => setAuthScreen('register')}
          className="flex-1 bg-revis-dark-gray text-gray-500 font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors text-sm"
        >
          &lt; {t('back')}
        </button>
        <button 
          onClick={confirmRegister} 
          disabled={!acceptedTerms || !acceptedPrivacy}
          className="flex-1 bg-revis-green disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm"
        >
          {t('next')}
        </button>
      </div>
      <Footer />
    </div>
  );

  const renderSuccess = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-revis-black text-center">
      <h1 className="text-2xl font-bold text-revis-heading mb-2">{t('accountCreated')}</h1>
      <p className="text-gray-500 mb-8 max-w-xs text-xs">
        {t('journeyBegins')}
      </p>
      <button 
        onClick={() => { setAuthScreen('app'); setShowAddVehicle(true); }}
        className="w-full max-w-sm bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm mb-3"
      >
        {t('addVehicle')}
      </button>
      <button 
        onClick={() => { setAuthScreen('app'); setActiveTab('garage'); }}
        className="w-full max-w-sm bg-revis-dark-gray text-revis-heading font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors text-sm"
      >
        {t('goToGarage')}
      </button>
      <p className="text-xs text-revis-gray mt-4">
        {t('manageFree')} <span className="text-revis-green font-bold cursor-pointer">{t('viewPlans')}</span>
      </p>
      <Footer />
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-4 pb-24">
      <div className="bg-revis-dark-gray rounded-2xl p-6 border border-revis-gray/20">
        <h2 className="text-xl font-bold text-revis-heading mb-2">{t('welcomeUser')} {user?.nickname || user?.name?.split(' ')[0]}!</h2>
        <p className="text-revis-gray text-sm">
          {t('vehiclesRegistered').replace('{count}', vehicles.length.toString()).replace(/{s}/g, vehicles.length !== 1 ? 's' : '')}
        </p>
        <div className="mt-4 flex gap-2">
          <button 
            onClick={() => setActiveTab('garage')}
            className="bg-revis-green text-black font-bold py-2 px-4 rounded-xl text-sm hover:bg-opacity-90 transition-colors"
          >
            {t('goToGarage')}
          </button>
          <button 
            onClick={() => setActiveTab('advisor')}
            className="bg-revis-dark-gray border border-revis-gray/30 text-white font-bold py-2 px-4 rounded-xl text-sm hover:bg-revis-gray/20 transition-colors"
          >
            {t('talkToDrGraxa')}
          </button>
        </div>
      </div>
    </div>
  );

  const [vehicleSearch, setVehicleSearch] = useState('');

  const renderMenu = () => (
    <div className="space-y-4 animate-in fade-in duration-300">
      <h2 className="text-2xl font-bold text-revis-heading mb-6">{t('menu')}</h2>
      
      <div className="bg-revis-dark-gray rounded-xl p-4 flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-full bg-revis-black border border-revis-gray/30 flex items-center justify-center text-revis-green font-bold text-xl">
          {user?.name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        <div>
          <h3 className="font-bold text-revis-heading">{user?.name}</h3>
          <p className="text-sm text-revis-gray">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-3">
        <button 
          onClick={() => setShowProfileEdit(true)}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <UserIcon className="w-5 h-5 text-revis-green" />
            <span className="font-medium">{t('profileData')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button 
          onClick={() => { 
            if (user?.plan === 'premium') {
              setShowChatHistory(true); 
            } else {
              setShowUpgradeModal(true);
            }
          }}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-revis-green" />
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('chatHistory')}</span>
              <Crown className="w-3 h-3 text-yellow-500 fill-yellow-500" />
            </div>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button 
          onClick={() => { 
            if (user?.plan === 'premium') {
              setShowVehicleHistory(true); 
            } else {
              setShowUpgradeModal(true);
            }
          }}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-revis-green" />
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('vehicleHistory')}</span>
              <Crown className="w-3 h-3 text-yellow-500 fill-yellow-500" />
            </div>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button 
          onClick={() => setShowUpgradeModal(true)}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Crown className="w-5 h-5 text-revis-green" />
            <span className="font-medium">{user?.plan === 'premium' ? 'Gerenciar Plano' : t('plans')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button
          type="button"
          onClick={() => { setSupportMethod(null); setIsSupportModalOpen(true); }}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-revis-green" />
            <span className="font-medium">{t('support')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button 
          onClick={() => setShowTermsModal(true)}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-revis-green" />
            <span className="font-medium">{t('terms')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>

        <button 
          onClick={() => setShowPrivacyModal(true)}
          className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-heading hover:bg-revis-gray/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-revis-green" />
            <span className="font-medium">{t('privacy')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-revis-gray" />
        </button>
      </div>

      <button 
        onClick={() => {
          localStorage.removeItem('revis_user');
          setUser(null);
          setAuthScreen('login');
          setActiveTab('garage');
        }}
        className="w-full bg-revis-dark-gray p-4 rounded-xl flex justify-between items-center text-revis-alert-critical hover:bg-revis-gray/20 transition-colors mt-8"
      >
        <span className="font-medium">{t('logout')}</span>
      </button>

      <div className="mt-8">
        <Footer />
      </div>
    </div>
  );

  const renderPreferences = () => (
    <div className="space-y-4 animate-in fade-in duration-300 pb-20">
      <h2 className="text-2xl font-bold text-revis-heading mb-6">{t('preferences')}</h2>
      
      <div className="space-y-6">
        {/* Theme */}
        <div className="bg-revis-dark-gray p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-revis-heading flex items-center gap-2">
            <Paintbrush className="w-5 h-5 text-revis-green" />
            Tema
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => applyThemeImmediate('dark')}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${tempTheme === 'dark' ? 'bg-revis-green text-black border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
            >
              Escuro
            </button>
            <button
              onClick={() => applyThemeImmediate('light')}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${tempTheme === 'light' ? 'bg-revis-green text-black border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
            >
              Claro
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="bg-revis-dark-gray p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-revis-heading flex items-center gap-2">
            <Globe className="w-5 h-5 text-revis-green" />
            Idioma
          </h3>
          <div className="space-y-2">
            {Object.keys(translations).map((lang) => (
              <button
                key={lang}
                onClick={() => applyLanguageImmediate(lang)}
                className={`w-full p-3 rounded-lg border text-sm font-medium transition-colors flex justify-between items-center ${tempLanguage === lang ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
              >
                {lang}
                {tempLanguage === lang && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="bg-revis-dark-gray p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-revis-heading flex items-center gap-2">
            <Type className="w-5 h-5 text-revis-green" />
            Tamanho da Fonte
          </h3>
          <div className="flex items-center gap-4">
            <span className="text-xs text-revis-gray">A</span>
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              value={tempFontSize}
              onChange={(e) => applyFontSizeImmediate(parseInt(e.target.value))}
              className="flex-1 h-2 bg-revis-black rounded-lg appearance-none cursor-pointer accent-revis-green"
            />
            <span className="text-xl text-revis-heading">A</span>
          </div>
          <p className="text-xs text-revis-gray text-center">
            {tempFontSize === 0 && 'Muito Pequeno'}
            {tempFontSize === 1 && 'Pequeno'}
            {tempFontSize === 2 && 'Normal'}
            {tempFontSize === 3 && 'Grande'}
            {tempFontSize === 4 && 'Muito Grande'}
          </p>
        </div>

        {/* Date Format */}
        <div className="bg-revis-dark-gray p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-revis-heading flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-revis-green" />
            {t('dateFormatLabel')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${tempDateFormat === 'dd/mm/yyyy' ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
            >
              <input
                type="radio"
                name="dateFormat"
                value="dd/mm/yyyy"
                checked={tempDateFormat === 'dd/mm/yyyy'}
                onChange={() => applyDateFormatImmediate('dd/mm/yyyy')}
                className="accent-revis-green"
              />
              <span>{getDateFormatDisplay('dd/mm/yyyy', language)}</span>
            </label>
            <label
              className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${tempDateFormat === 'mm/dd/yyyy' ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
            >
              <input
                type="radio"
                name="dateFormat"
                value="mm/dd/yyyy"
                checked={tempDateFormat === 'mm/dd/yyyy'}
                onChange={() => applyDateFormatImmediate('mm/dd/yyyy')}
                className="accent-revis-green"
              />
              <span>{getDateFormatDisplay('mm/dd/yyyy', language)}</span>
            </label>
          </div>
          <p className="text-xs text-revis-gray">
            {t('dateFormatPreview')}: <span className="text-revis-light-gray font-medium">{formatAppDate(new Date(), tempDateFormat)}</span>
          </p>
        </div>

        {/* Currency */}
        <div className="bg-revis-dark-gray p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-revis-heading flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-revis-green" />
            {t('currencyLabel')}
          </h3>
          <select
            value={tempCurrency}
            onChange={(e) => applyCurrencyImmediate(e.target.value)}
            className="w-full bg-revis-black/40 border border-revis-gray/30 rounded-lg p-3 text-sm text-revis-light-gray focus:border-revis-green outline-none"
          >
            {CURRENCY_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code} className="bg-revis-dark-gray text-revis-light-gray">
                {opt.code} — {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-revis-gray">
            {t('currencyPreview')}: <span className="text-revis-light-gray font-medium">{formatAppCurrency(1234.56, tempCurrency, tempLanguage)}</span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <button 
            onClick={() => setShowPreferencesCancelConfirmation(true)}
            className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors"
          >
            {t('cancel')}
          </button>
          <button 
            onClick={() => setShowPreferencesSaveConfirmation(true)}
            className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderGarage = () => {
    if (!selectedVehicle) {
      const searchLower = (vehicleSearch || '').toLowerCase();
      const filteredVehicles = vehicles.filter(v => 
        (v.model || '').toLowerCase().includes(searchLower) || 
        (v.brand || '').toLowerCase().includes(searchLower) ||
        (v.nickname || '').toLowerCase().includes(searchLower)
      );

      return (
        <div className="space-y-4 pb-24 md:pb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-revis-heading flex items-center gap-2">
              {t('garageOf')} {user?.nickname || user?.name?.split(' ')[0]}
              {user?.plan === 'premium' && (
                <div className="group relative">
                  <Crown className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Recurso Premium
                  </div>
                </div>
              )}
            </h2>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-revis-gray" />
            <input 
              type="text"
              placeholder={t('searchVehicle')}
              className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl py-3 pl-10 pr-4 text-revis-light-gray outline-none transition-colors text-sm"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
            />
          </div>

          <button 
            onClick={() => {
              if (user?.plan === 'free' && vehicles.length >= 1) {
                setShowUpgradeModal(true);
              } else {
                setNewVehicle({
                  type: 'Carro',
                  brand: '',
                  model: '',
                  year: new Date().getFullYear(),
                  current_mileage: 0,
                  last_service_date: new Date().toISOString().split('T')[0],
                  nickname: '',
                  color: ''
                });
                setCustomBrand('');
                setCustomModel('');
                setCustomColor('');
                setOtherColor('');
                setIsEditingVehicle(false);
                setShowAddVehicle(true);
              }
            }}
            className={`w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 mb-4 ${
              user?.plan === 'free' && vehicles.length >= 1 
                ? 'bg-revis-dark-gray text-revis-gray cursor-not-allowed border border-revis-gray/20' 
                : 'bg-revis-green text-black hover:bg-opacity-90'
            }`}
          >
            {user?.plan === 'free' && vehicles.length >= 1 ? (
              <>
                <div className="group relative">
                  <Crown className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Recurso Premium
                  </div>
                </div>
                {t('addVehicle')}
              </>
            ) : (
              <>
                <Plus className="w-5 h-5" />
                {t('addVehicle')}
              </>
            )}
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredVehicles.map(vehicle => (
              <div
                key={vehicle.id}
                className="bg-revis-dark-gray rounded-xl p-4 border border-revis-gray/10 flex items-center gap-4"
              >
                <div className="p-3 bg-revis-black/30 rounded-full flex-shrink-0">
                  {vehicle.type === 'Carro' && <Car className="w-5 h-5 text-revis-green" />}
                  {vehicle.type === 'Moto' && <Bike className="w-5 h-5 text-revis-green" />}
                  {vehicle.type === 'Bike' && <Zap className="w-5 h-5 text-revis-green" />}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-revis-heading text-base truncate">
                    {user?.plan === 'premium' && vehicle.nickname ? vehicle.nickname : vehicle.model}
                  </h3>
                  <p className="text-xs text-revis-gray truncate">
                    {user?.plan === 'premium' && vehicle.nickname ? `${vehicle.model} • ` : ''}
                    {vehicle.brand} • {vehicle.year}
                    {user?.plan === 'premium' && vehicle.color ? ` • ${vehicle.color}` : ''}
                    {!(user?.plan === 'premium' && (vehicle.nickname || vehicle.color)) ? ` • ${(vehicle.current_mileage || 0).toLocaleString()} km` : ''}
                  </p>
                </div>

                <button 
                  onClick={() => {
                    setSelectedVehicle(vehicle);
                    setExpandedCards({ mileage: false, services: false, financial: false });
                  }}
                  className="text-xs text-revis-green font-medium whitespace-nowrap hover:underline"
                >
                  {t('details')} &gt;
                </button>
              </div>
            ))}
          </div>

          {filteredVehicles.length === 0 && (
            <div className="text-center py-10 text-revis-gray">
              <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>{vehicles.length === 0 ? t('noVehicles') : t('noVehiclesFound')}</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6 pb-24 md:pb-4">
        {/* Header with Back Button */}
        <div className="flex items-center gap-2 mb-4 sticky top-16 md:top-0 bg-revis-black z-10 py-2">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setSelectedVehicle(null);
            }} 
            className="p-2 -ml-2 text-revis-gray hover:text-revis-green transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-revis-heading">{selectedVehicle.brand} {selectedVehicle.model}</h2>
            {user?.plan === 'premium' && (selectedVehicle.nickname || selectedVehicle.color) && (
              <p className="text-sm text-revis-green mb-1">
                {selectedVehicle.nickname && <span className="font-medium">{selectedVehicle.nickname}</span>}
                {selectedVehicle.nickname && selectedVehicle.color && <span className="mx-1">•</span>}
                {selectedVehicle.color && <span>Cor: {selectedVehicle.color}</span>}
              </p>
            )}
            <p className="text-sm text-revis-gray">{selectedVehicle.year} • {(selectedVehicle.current_mileage || 0).toLocaleString()} km</p>
          </div>
          {selectedVehicle.status !== 'archived' && (
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  setNewVehicle(selectedVehicle);
                  setCustomBrand(selectedVehicle.brand);
                  setCustomModel(selectedVehicle.model);
                  setCustomColor(selectedVehicle.color || '');
                  setOtherColor(selectedVehicle.color || '');
                  setIsEditingVehicle(true);
                  setShowAddVehicle(true);
                }}
                className="p-2 text-revis-gray hover:text-revis-green hover:bg-revis-green/10 rounded-lg transition-colors"
                title="Editar veículo"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setShowDeleteVehicleModal(true)}
                className="p-2 text-revis-alert-critical hover:bg-revis-alert-critical/10 rounded-lg transition-colors"
                title={t('deleteVehicleAria')}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Mileage History Card */}
        <div className="bg-revis-dark-gray rounded-2xl p-5 border border-revis-gray/20">
          <div 
            className="flex justify-between items-center cursor-pointer" 
            onClick={() => setExpandedCards(prev => ({ ...prev, mileage: !prev.mileage }))}
          >
            <h3 className="font-bold text-revis-heading">{t('mileageHistory')}</h3>
            {expandedCards.mileage ? <ChevronUp className="w-5 h-5 text-revis-gray" /> : <ChevronDown className="w-5 h-5 text-revis-gray" />}
          </div>
          
          {expandedCards.mileage && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateMileage}
                  className="w-full bg-revis-green/10 text-revis-green font-medium px-4 py-3 rounded-xl text-sm hover:bg-revis-green/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4">
                <button 
                  onClick={() => setShowDateFilters(!showDateFilters)}
                  className="flex items-center gap-2 text-xs text-revis-gray hover:text-revis-green transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                
                {showDateFilters && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={mileageFilterDate.start}
                          onChange={e => setMileageFilterDate({...mileageFilterDate, start: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setActiveMileageFilter(mileageFilterDate);
                            setMileageLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('filter')}
                        </button>
                      </div>
                      <div className="text-center text-[10px] text-revis-gray">{t('to')}</div>
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={mileageFilterDate.end}
                          onChange={e => setMileageFilterDate({...mileageFilterDate, end: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setMileageFilterDate({ start: '', end: '' });
                            setActiveMileageFilter(null);
                            setMileageLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('clear')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {activeMileageFilter && (
                <div className="mb-4 p-3 bg-revis-black/20 rounded-xl flex justify-between items-center">
                  <span className="text-sm text-revis-gray">{t('kmDriven')}:</span>
                  <span className="text-revis-heading font-bold">
                    {(() => {
                      const start = new Date(activeMileageFilter.start);
                      const end = new Date(activeMileageFilter.end);
                      
                      let total = 0;
                      const allLogs = selectedVehicle.mileage_history || [];

                      allLogs.forEach((log, index) => {
                         const logDate = new Date(log.date);
                         if (logDate >= start && logDate <= end) {
                            const prevLog = allLogs[index + 1];
                            const diff = prevLog ? log.mileage - prevLog.mileage : 0;
                            total += Math.abs(diff);
                         }
                      });

                      return `${total.toLocaleString()} km`;
                    })()}
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-3 text-xs text-revis-gray font-medium pl-2 pr-16 text-center">
                  <span>{t('date')}</span>
                  <span>{t('km')}</span>
                  <span>{t('balance')}</span>
                </div>
                
                {(() => {
                  let displayLogs = selectedVehicle.mileage_history || [];

                  if (activeMileageFilter) {
                    const start = new Date(activeMileageFilter.start);
                    const end = new Date(activeMileageFilter.end);
                    displayLogs = displayLogs.filter(log => {
                      const d = new Date(log.date);
                      return d >= start && d <= end;
                    });
                  }

                  const hasMore = displayLogs.length > mileageLimit;
                  const paginatedLogs = displayLogs.slice(0, mileageLimit);

                  return (
                    <>
                      {paginatedLogs.map((log, index) => {
                        const originalIndex = selectedVehicle.mileage_history?.findIndex(l => l === log) ?? 0;
                        const prevLog = selectedVehicle.mileage_history?.[originalIndex + 1];
                        const isLast = originalIndex === (selectedVehicle.mileage_history?.length || 0) - 1;
                        const rawDiff = prevLog ? log.mileage - prevLog.mileage : 0;
                        const balance = Math.abs(rawDiff);

                        const stableKey = log.id ? String(log.id) : `${log.date}-${log.mileage}-${index}`;

                        return (
                          <div key={stableKey} className="relative grid grid-cols-3 text-sm pl-2 pr-16 py-2 border-b border-revis-gray/10 last:border-0 text-center items-center group">
                            <span className="text-revis-light-gray">{formatAppDate(log.date, dateFormat)}</span>
                            <span className="text-revis-light-gray">{(log.mileage || 0).toLocaleString()} km</span>
                            <span className={isLast ? 'text-revis-gray' : 'text-revis-alert-critical'}>
                              {isLast ? t('initialRecord') : `${balance.toLocaleString()} km`}
                            </span>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openViewRecord({ kind: 'mileage', data: log })}
                                aria-label={t('viewRecordAria')}
                                className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {log.id && (
                                <button
                                  type="button"
                                  onClick={() => openEditMileage(log)}
                                  aria-label={t('editMileageTitle')}
                                  className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {displayLogs.length === 0 && (
                         <div className="text-center text-xs text-revis-gray py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button
                          onClick={() => setMileageLimit(prev => prev + 10)}
                          className="w-full text-center text-xs text-revis-green font-medium py-2 hover:underline mt-2"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Service History Card */}
        <div className="bg-revis-dark-gray rounded-2xl p-5 border border-revis-gray/20">
          <div 
            className="flex justify-between items-center cursor-pointer" 
            onClick={() => setExpandedCards(prev => ({ ...prev, services: !prev.services }))}
          >
            <h3 className="font-bold text-revis-heading">{t('serviceHistory')}</h3>
            {expandedCards.services ? <ChevronUp className="w-5 h-5 text-revis-gray" /> : <ChevronDown className="w-5 h-5 text-revis-gray" />}
          </div>

          {expandedCards.services && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateLog}
                  className="w-full bg-revis-green/10 text-revis-green font-medium px-4 py-3 rounded-xl text-sm hover:bg-revis-green/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4">
                <button 
                  onClick={() => setShowDateFilters(!showDateFilters)}
                  className="flex items-center gap-2 text-xs text-revis-gray hover:text-revis-green transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                
                {showDateFilters && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={servicesFilterDate.start}
                          onChange={e => setServicesFilterDate({...servicesFilterDate, start: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setActiveServicesFilter(servicesFilterDate);
                            setServicesLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('filter')}
                        </button>
                      </div>
                      <div className="text-center text-[10px] text-revis-gray">{t('to')}</div>
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={servicesFilterDate.end}
                          onChange={e => setServicesFilterDate({...servicesFilterDate, end: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setServicesFilterDate({ start: '', end: '' });
                            setActiveServicesFilter(null);
                            setServicesLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('clear')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {activeServicesFilter && (
                <div className="mb-4 p-3 bg-revis-black/20 rounded-xl flex justify-between items-center">
                  <span className="text-sm text-revis-gray">{t('totalSpent')}:</span>
                  <span className="text-revis-green font-bold">
                    {formatAppCurrency(
                      logs
                        .filter(log => {
                          const d = new Date(log.date);
                          const start = new Date(activeServicesFilter.start);
                          const end = new Date(activeServicesFilter.end);
                          return d >= start && d <= end;
                        })
                        .reduce((acc, log) => acc + log.cost, 0),
                      currency,
                      language,
                    )}
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-4 text-xs text-revis-gray font-medium pl-2 pr-16 gap-2 text-center">
                  <span>{t('date')}</span>
                  <span>{t('service')}</span>
                  <span>{t('responsible')}</span>
                  <span>{t('value')}</span>
                </div>

                {(() => {
                  let displayLogs = logs;
                  
                  if (activeServicesFilter) {
                    const start = new Date(activeServicesFilter.start);
                    const end = new Date(activeServicesFilter.end);
                    displayLogs = displayLogs.filter(log => {
                      const d = new Date(log.date);
                      return d >= start && d <= end;
                    });
                  }
                  
                  const hasMore = displayLogs.length > servicesLimit;
                  const paginatedLogs = displayLogs.slice(0, servicesLimit);

                  return (
                    <>
                      {paginatedLogs.map(log => (
                        <div key={log.id} className="relative grid grid-cols-4 text-sm pl-2 pr-16 py-2 border-b border-revis-gray/10 last:border-0 gap-2 items-center text-center group">
                          <span className="text-revis-light-gray text-xs">{formatAppDate(log.date, dateFormat)}</span>
                          <span className="text-revis-light-gray truncate" title={log.description}>{log.description}</span>
                          <span className="text-revis-light-gray truncate" title={log.provider || '-'}>{log.provider || '-'}</span>
                          <span className="text-revis-green text-xs">{formatAppCurrency(log.cost, currency, language)}</span>
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openViewRecord({ kind: 'maintenance', data: log })}
                              aria-label={t('viewRecordAria')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditLog(log)}
                              aria-label={t('editMaintenanceTitle')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {displayLogs.length === 0 && (
                        <div className="text-center text-xs text-revis-gray py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button 
                          onClick={() => setServicesLimit(prev => prev + 10)}
                          className="w-full text-center text-xs text-revis-green font-medium py-2 hover:underline mt-2"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Financial Records Card */}
        <div className={`bg-revis-dark-gray rounded-2xl p-5 border ${user?.plan === 'free' ? 'border-revis-gray/20 opacity-75' : 'border-revis-gray/20'}`}>
          <div 
            className="flex justify-between items-center cursor-pointer" 
            onClick={() => {
              if (user?.plan === 'free') {
                setShowUpgradeModal(true);
              } else {
                setExpandedCards(prev => ({ ...prev, financial: !prev.financial }));
              }
            }}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-revis-heading">{t('financialSectionTitle')}</h3>
              {user?.plan === 'premium' && (
                <div className="group relative">
                  <Crown className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Recurso Premium
                  </div>
                </div>
              )}
              {user?.plan === 'free' && (
                <div className="group relative">
                  <Crown className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    Recurso Premium
                  </div>
                </div>
              )}
            </div>
            {user?.plan === 'premium' && (
              expandedCards.financial ? <ChevronUp className="w-5 h-5 text-revis-gray" /> : <ChevronDown className="w-5 h-5 text-revis-gray" />
            )}
          </div>

          {user?.plan === 'free' && (
            <div className="mt-2 text-xs text-revis-green font-medium flex items-center gap-1">
              Conheça nossos planos para liberar esse recurso.
            </div>
          )}

          {expandedCards.financial && user?.plan === 'premium' && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateFinancial}
                  className="w-full bg-revis-green/10 text-revis-green font-medium px-4 py-3 rounded-xl text-sm hover:bg-revis-green/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4">
                <button 
                  onClick={() => setShowDateFilters(!showDateFilters)}
                  className="flex items-center gap-2 text-xs text-revis-gray hover:text-revis-green transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showDateFilters && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={financialFilterDate.start}
                          onChange={e => setFinancialFilterDate({...financialFilterDate, start: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setActiveFinancialFilter(financialFilterDate);
                            setFinancialLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('filter')}
                        </button>
                      </div>
                      <div className="text-center text-[10px] text-revis-gray">{t('to')}</div>
                      <div className="flex gap-2 items-center">
                        <input 
                          type="date" 
                          className="bg-revis-black/30 text-revis-light-gray text-[10px] rounded-lg px-2 py-1 border border-revis-gray/20 outline-none flex-1"
                          value={financialFilterDate.end}
                          onChange={e => setFinancialFilterDate({...financialFilterDate, end: e.target.value})}
                        />
                        <button 
                          onClick={() => {
                            setFinancialFilterDate({ start: '', end: '' });
                            setActiveFinancialFilter(null);
                            setFinancialLimit(10);
                          }}
                          className="bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray text-[10px] px-3 py-1 rounded-lg hover:bg-revis-gray/20 transition-colors w-20"
                        >
                          {t('clear')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {activeFinancialFilter && (
                <div className="mb-4 p-3 bg-revis-black/20 rounded-xl flex justify-between items-center">
                  <span className="text-sm text-revis-gray">{t('totalLabel')}</span>
                  <span className="text-revis-green font-bold">
                    {formatAppCurrency(
                      financialRecords
                        .filter(rec => {
                          const d = new Date(rec.due_date);
                          const start = new Date(activeFinancialFilter.start);
                          const end = new Date(activeFinancialFilter.end);
                          return d >= start && d <= end;
                        })
                        .reduce((acc, rec) => acc + rec.value, 0),
                      currency,
                      language,
                    )}
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-4 text-xs text-revis-gray font-medium pl-2 pr-16 gap-2 text-center">
                  <span>Vencimento</span>
                  <span>Descrição</span>
                  <span>Situação</span>
                  <span>Valor</span>
                </div>

                {(() => {
                  let displayRecords = financialRecords;
                  
                  if (activeFinancialFilter) {
                    const start = new Date(activeFinancialFilter.start);
                    const end = new Date(activeFinancialFilter.end);
                    displayRecords = displayRecords.filter(rec => {
                      const d = new Date(rec.due_date);
                      return d >= start && d <= end;
                    });
                  }
                  
                  const hasMore = displayRecords.length > financialLimit;
                  const paginatedRecords = displayRecords.slice(0, financialLimit);

                  return (
                    <>
                      {paginatedRecords.map(rec => (
                        <div key={rec.id} className="relative grid grid-cols-4 text-sm pl-2 pr-16 py-2 border-b border-revis-gray/10 last:border-0 gap-2 items-center text-center group">
                          <span className="text-revis-light-gray text-xs">{formatAppDate(rec.due_date, dateFormat)}</span>
                          <span className="text-revis-light-gray truncate" title={rec.description}>{rec.description}</span>
                          <span className={`text-xs ${rec.status === 'Pago' ? 'text-revis-green' : rec.status === 'Atrasado' ? 'text-revis-alert-critical' : 'text-revis-alert-medium'}`}>{rec.status}</span>
                          <span className="text-revis-green text-xs">{formatAppCurrency(rec.value, currency, language)}</span>
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openViewRecord({ kind: 'financial', data: rec })}
                              aria-label={t('viewRecordAria')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditFinancial(rec)}
                              aria-label={t('editFinancialTitle')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {displayRecords.length === 0 && (
                        <div className="text-center text-xs text-revis-gray py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button 
                          onClick={() => setFinancialLimit(prev => prev + 10)}
                          className="w-full text-center text-xs text-revis-green font-medium py-2 hover:underline mt-2"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAdvisor = () => {
    if (user?.plan === 'free') {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] text-center px-6">
          <div className="w-20 h-20 bg-revis-dark-gray rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Shield className="w-10 h-10 text-revis-green" />
          </div>
          <h2 className="text-xl font-bold text-revis-heading mb-3">{t('premiumFeature')}</h2>
          <p className="text-revis-gray mb-8 text-sm leading-relaxed max-w-xs mx-auto">{t('drGraxaLocked')}</p>
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="w-full max-w-xs bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors shadow-lg shadow-revis-green/20"
          >
            {t('knowPlans')}
          </button>
        </div>
      );
    }

    return (
    <div className="flex flex-col h-[calc(100dvh-135px)] md:h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold text-revis-heading flex items-center gap-2">
            <div className="group relative">
              <Crown className="w-5 h-5 text-yellow-500 fill-yellow-500" />
              <div className="absolute top-full left-0 mt-2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Recurso Premium
              </div>
            </div>
            Dr. Graxa
          </h2>
          <button 
            onClick={() => setShowChatHistory(true)}
            className="bg-revis-green text-black text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-opacity-90 transition-colors"
          >
            Histórico
          </button>
        </div>
        
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-revis-gray whitespace-nowrap">{t('advisorVehiclePrompt')}</span>
          <select
            className="flex-1 bg-revis-dark-gray border border-revis-gray/20 rounded-xl px-4 py-2 text-xs text-revis-light-gray outline-none focus:border-revis-green transition-colors appearance-none"
            value={selectedVehicle?.id || ''}
            onChange={(e) => {
              const vehicleId = parseInt(e.target.value);
              const vehicle = vehicles.find(v => v.id === vehicleId);
              setSelectedVehicle(vehicle || null);
              if (vehicle) {
                setExpandedCards({ mileage: false, services: false, financial: false });
                fetchLogs(vehicle.id);
                fetchFinancialRecords(vehicle.id);
              } else {
                setLogs([]);
                setFinancialRecords([]);
              }
            }}
          >
            <option value="">Nenhum</option>
            {[...vehicles].sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || (a.model || '').localeCompare(b.model || '')).map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.brand} {vehicle.model} ({vehicle.year})
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1 scrollbar-hide flex flex-col">
        {chatMessages.length === 0 && (
          <div className="text-center text-revis-gray mt-10 px-4">
            <div className="relative w-12 h-12 mx-auto mb-4 opacity-20">
              <Shield className="w-12 h-12" />
              <Wrench className="w-6 h-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 fill-current" />
            </div>
            <p className="mb-6 text-[10px]">{t('drGraxaDesc')}</p>
          </div>
        )}
        
        {chatMessages.map((msg) => (
          <div 
            key={msg.id} 
            className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300 ${
              msg.sender === 'user' 
                ? 'bg-revis-green text-black self-end rounded-tr-none' 
                : 'bg-white text-black self-start rounded-tl-none'
            }`}
          >
            <ReactMarkdown>{msg.content}</ReactMarkdown>
            <div className={`text-[9px] mt-1 text-right opacity-60 ${msg.sender === 'user' ? 'text-black' : 'text-gray-500'}`}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        {isLoadingAi && (
           <div className="bg-white text-black self-start rounded-2xl rounded-tl-none p-3 shadow-md max-w-[85%]">
             <div className="flex gap-1">
               <div className="w-1.5 h-1.5 bg-black rounded-full animate-bounce"></div>
               <div className="w-1.5 h-1.5 bg-black rounded-full animate-bounce delay-100"></div>
               <div className="w-1.5 h-1.5 bg-black rounded-full animate-bounce delay-200"></div>
             </div>
           </div>
        )}
      </div>

      <div className="mt-auto pt-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={t('advisorInputPlaceholder')}
            className="flex-1 bg-revis-dark-gray border border-revis-gray/20 rounded-xl px-4 py-3 text-xs text-revis-light-gray focus:outline-none focus:border-revis-green transition-colors placeholder:text-revis-gray/50"
            onKeyDown={(e) => e.key === 'Enter' && askAi()}
          />
          <button 
            onClick={askAi}
            disabled={isLoadingAi || !aiPrompt.trim()}
            className="bg-revis-green disabled:opacity-50 disabled:cursor-not-allowed text-black px-4 rounded-xl transition-colors font-bold flex items-center justify-center"
          >
            {isLoadingAi ? <Activity className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 fill-black" />}
          </button>
        </div>
        <p className="text-[9px] text-revis-gray text-center mt-2 opacity-60">
          {t('advisorDisclaimer')}
        </p>
      </div>
    </div>
    );
  };

  const renderOnboardingPreferences = () => (
    <div className="min-h-screen bg-revis-black text-revis-light-gray flex flex-col">
      <div className="max-w-md w-full mx-auto px-6 py-10 flex-1 flex flex-col">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-revis-heading mb-2">{t('onboardingTitle')}</h1>
          <p className="text-revis-gray text-sm">{t('onboardingSubtitle')}</p>
        </div>

        <div className="space-y-5 flex-1">
          {/* Theme */}
          <div className="bg-revis-dark-gray p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-revis-heading flex items-center gap-2">
              <Paintbrush className="w-5 h-5 text-revis-green" />
              {t('themeLabel')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyThemeImmediate('dark')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${theme === 'dark' ? 'bg-revis-green text-black border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
              >
                {t('darkTheme')}
              </button>
              <button
                type="button"
                onClick={() => applyThemeImmediate('light')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${theme === 'light' ? 'bg-revis-green text-black border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
              >
                {t('lightTheme')}
              </button>
            </div>
          </div>

          {/* Language */}
          <div className="bg-revis-dark-gray p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-revis-heading flex items-center gap-2">
              <Globe className="w-5 h-5 text-revis-green" />
              {t('languageLabel')}
            </h3>
            <div className="space-y-2">
              {Object.keys(translations).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => applyLanguageImmediate(lang)}
                  className={`w-full p-3 rounded-lg border text-sm font-medium transition-colors flex justify-between items-center ${language === lang ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
                >
                  {lang}
                  {language === lang && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="bg-revis-dark-gray p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-revis-heading flex items-center gap-2">
              <Type className="w-5 h-5 text-revis-green" />
              {t('fontSizeLabel')}
            </h3>
            <div className="flex items-center gap-4">
              <span className="text-xs text-revis-gray">A</span>
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={fontSize}
                onChange={(e) => applyFontSizeImmediate(parseInt(e.target.value))}
                className="flex-1 h-2 bg-revis-black rounded-lg appearance-none cursor-pointer accent-revis-green"
              />
              <span className="text-xl text-revis-heading">A</span>
            </div>
          </div>

          {/* Date Format */}
          <div className="bg-revis-dark-gray p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-revis-heading flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-revis-green" />
              {t('dateFormatLabel')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${dateFormat === 'dd/mm/yyyy' ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
              >
                <input
                  type="radio"
                  name="onboardingDateFormat"
                  value="dd/mm/yyyy"
                  checked={dateFormat === 'dd/mm/yyyy'}
                  onChange={() => applyDateFormatImmediate('dd/mm/yyyy')}
                  className="accent-revis-green"
                />
                <span>{getDateFormatDisplay('dd/mm/yyyy', language)}</span>
              </label>
              <label
                className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${dateFormat === 'mm/dd/yyyy' ? 'bg-revis-green/10 text-revis-green border-revis-green' : 'bg-transparent text-revis-gray border-revis-gray/30'}`}
              >
                <input
                  type="radio"
                  name="onboardingDateFormat"
                  value="mm/dd/yyyy"
                  checked={dateFormat === 'mm/dd/yyyy'}
                  onChange={() => applyDateFormatImmediate('mm/dd/yyyy')}
                  className="accent-revis-green"
                />
                <span>{getDateFormatDisplay('mm/dd/yyyy', language)}</span>
              </label>
            </div>
            <p className="text-xs text-revis-gray">
              {t('dateFormatPreview')}: <span className="text-revis-light-gray font-medium">{formatAppDate(new Date(), dateFormat)}</span>
            </p>
          </div>

          {/* Currency */}
          <div className="bg-revis-dark-gray p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-revis-heading flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-revis-green" />
              {t('currencyLabel')}
            </h3>
            <select
              value={currency}
              onChange={(e) => applyCurrencyImmediate(e.target.value)}
              className="w-full bg-revis-black/40 border border-revis-gray/30 rounded-lg p-3 text-sm text-revis-light-gray focus:border-revis-green outline-none"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code} className="bg-revis-dark-gray text-revis-light-gray">
                  {opt.code} — {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-revis-gray">
              {t('currencyPreview')}: <span className="text-revis-light-gray font-medium">{formatAppCurrency(1234.56, currency, language)}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            // Persistência síncrona: as mudanças já foram aplicadas em modo
            // imediato (ver useEffect que escreve no localStorage). Aqui apenas
            // direcionamos para a tela de boas-vindas com o CTA de primeiro veículo.
            setAuthScreen('success');
          }}
          className="w-full mt-8 bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors text-base"
        >
          {t('onboardingFinishCta')}
        </button>

        <div className="mt-6">
          <Footer />
        </div>
      </div>
    </div>
  );

  if (authScreen === 'login') return renderLogin();
  if (authScreen === 'register') return renderRegister();
  if (authScreen === 'terms') return renderTerms();
  if (authScreen === 'success') return renderSuccess();
  if (authScreen === 'onboarding_preferences') return renderOnboardingPreferences();
  if (authScreen === 'recover') return renderRecover();
  if (authScreen === 'reset-password') return renderResetPassword();

  return (
    <div className="min-h-screen bg-revis-black text-revis-light-gray font-sans selection:bg-revis-green selection:text-black">
      {/* Mobile Header - hidden on desktop */}
      <header className="md:hidden bg-revis-black/90 backdrop-blur-md border-b border-revis-dark-gray p-4 sticky top-0 z-20">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-revis-gray">Revis</span>
              <span className="text-revis-green">Auto</span>
            </h1>
          </div>
        </div>
      </header>

      <div className="md:flex md:min-h-screen">
        {/* Desktop Sidebar - hidden on mobile */}
        <aside className="hidden md:flex md:flex-col md:w-64 md:fixed md:inset-y-0 md:left-0 bg-revis-black border-r border-revis-dark-gray z-20">
          <div className="p-6 border-b border-revis-dark-gray">
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-revis-gray">Revis</span>
              <span className="text-revis-green">Auto</span>
            </h1>
          </div>
          <nav className="flex-1 flex flex-col gap-1 p-4">
            <button
              onClick={() => { setSelectedVehicle(null); setActiveTab('garage'); }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'garage' ? 'bg-revis-green text-black' : 'text-revis-gray hover:bg-revis-dark-gray hover:text-revis-heading'}`}
            >
              <Warehouse className="w-5 h-5 flex-shrink-0" />
              {t('garage')}
            </button>
            <button
              onClick={() => setActiveTab('advisor')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'advisor' ? 'bg-revis-green text-black' : 'text-revis-gray hover:bg-revis-dark-gray hover:text-revis-heading'}`}
            >
              <div className="relative flex-shrink-0 w-5 h-5">
                <Shield className="w-5 h-5" />
                <Wrench className="w-2.5 h-2.5 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              {t('advisor')}
            </button>
            <button
              onClick={() => setActiveTab('menu')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'menu' ? 'bg-revis-green text-black' : 'text-revis-gray hover:bg-revis-dark-gray hover:text-revis-heading'}`}
            >
              <Menu className="w-5 h-5 flex-shrink-0" />
              Menu
            </button>
            <button
              onClick={() => setActiveTab('preferences')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'preferences' ? 'bg-revis-green text-black' : 'text-revis-gray hover:bg-revis-dark-gray hover:text-revis-heading'}`}
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              Preferências
            </button>
          </nav>
          <div className="p-4 border-t border-revis-dark-gray">
            <p className="text-[10px] text-revis-gray text-center">{t('appShellTagline')}</p>
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 p-4 pb-24 md:ml-64 md:pb-8 md:p-8">
          <div className="max-w-5xl mx-auto">
            {activeTab === 'garage' && renderGarage()}
            {activeTab === 'advisor' && renderAdvisor()}
            {activeTab === 'menu' && renderMenu()}
            {activeTab === 'preferences' && renderPreferences()}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation - hidden on desktop */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-revis-black/95 backdrop-blur-lg border-t border-revis-dark-gray pb-safe z-20">
        <div className="flex justify-around items-center h-16">
          <button
            onClick={() => {
              setSelectedVehicle(null);
              setActiveTab('garage');
            }}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center ${activeTab === 'garage' ? 'text-revis-green' : 'text-revis-gray'}`}
          >
            <Warehouse className="w-6 h-6" />
            <span className="text-[10px] font-medium">{t('garage')}</span>
          </button>
          <button
            onClick={() => setActiveTab('advisor')}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center ${activeTab === 'advisor' ? 'text-revis-green' : 'text-revis-gray'}`}
          >
            <div className="relative">
              <Shield className={`w-6 h-6 ${activeTab === 'advisor' ? 'fill-current' : ''}`} />
              <Wrench className={`w-3 h-3 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${activeTab === 'advisor' ? 'fill-black' : 'fill-current'}`} />
            </div>
            <span className="text-[10px] font-medium">{t('advisor')}</span>
          </button>
          <button
            onClick={() => setActiveTab('menu')}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center ${activeTab === 'menu' ? 'text-revis-green' : 'text-revis-gray'}`}
          >
            <Menu className="w-6 h-6" />
            <span className="text-[10px] font-medium">{t('menu')}</span>
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center ${activeTab === 'preferences' ? 'text-revis-green' : 'text-revis-gray'}`}
          >
            <Settings className="w-6 h-6" />
            <span className="text-[10px] font-medium">{t('preferences')}</span>
          </button>
        </div>
      </nav>

      {/* Full Screen Modals for Mobile */}
      {/* Profile Menu Modal Removed */}

      {/* Chat History Modal */}
      {showChatHistory && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('chatHistory')}</h2>
              <button onClick={() => setShowChatHistory(false)} className="text-revis-gray p-2">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Filters */}
            <div className="bg-revis-dark-gray p-4 rounded-xl mb-6 space-y-4">
              <h3 className="text-revis-heading font-bold flex items-center gap-2">
                <Search className="w-4 h-4 text-revis-green" />
                {t('filterByDate').replace(/:\s*$/, '')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-revis-gray mb-1 block">{t('dateStartLabel')}</label>
                  <input 
                    type="date"
                    value={chatHistoryStartDate}
                    onChange={(e) => setChatHistoryStartDate(e.target.value)}
                    className="w-full bg-revis-black/30 border border-revis-gray/20 rounded-lg p-2 text-xs text-revis-light-gray focus:border-revis-green outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-revis-gray mb-1 block">{t('dateEndLabel')}</label>
                  <input 
                    type="date"
                    value={chatHistoryEndDate}
                    onChange={(e) => setChatHistoryEndDate(e.target.value)}
                    className="w-full bg-revis-black/30 border border-revis-gray/20 rounded-lg p-2 text-xs text-revis-light-gray focus:border-revis-green outline-none"
                  />
                </div>
              </div>
              {(chatHistoryStartDate || chatHistoryEndDate) && (
                <button 
                  onClick={() => { setChatHistoryStartDate(''); setChatHistoryEndDate(''); }}
                  className="w-full text-xs text-revis-alert-critical font-bold py-2 border border-revis-alert-critical/30 rounded-lg hover:bg-revis-alert-critical/10 transition-colors"
                >
                  {t('clearFilters')}
                </button>
              )}
            </div>

            {/* Sessions List */}
            <div className="space-y-3">
              {chatSessions
                .filter(session => {
                  if (!chatHistoryStartDate && !chatHistoryEndDate) return true;
                  const sessionDate = new Date(session.updated_at).toISOString().split('T')[0];
                  if (chatHistoryStartDate && sessionDate < chatHistoryStartDate) return false;
                  if (chatHistoryEndDate && sessionDate > chatHistoryEndDate) return false;
                  return true;
                })
                .map(session => {
                  // Find vehicle info
                  const sessionVehicle = session.vehicle_id ? vehicles.find(v => v.id === session.vehicle_id) || archivedVehicles.find(v => v.id === session.vehicle_id) : null;
                  
                  return (
                    <div key={session.id} className="relative group">
                      <button
                        onClick={() => loadChatSession(session.id)}
                        className="w-full bg-revis-dark-gray p-4 rounded-xl text-left hover:bg-revis-gray/20 transition-colors pr-10"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs text-revis-green font-bold flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatAppDate(session.updated_at, dateFormat)}
                          </span>
                          <ChevronLeft className="w-4 h-4 rotate-180 text-revis-gray group-hover:text-revis-green transition-colors" />
                        </div>
                        <h4 className="text-revis-heading font-medium text-sm line-clamp-2">{session.title}</h4>
                        {sessionVehicle && (
                          <p className="text-xs text-revis-gray mt-1 flex items-center gap-1">
                            <Car className="w-3 h-3" />
                            {sessionVehicle.brand} {sessionVehicle.model} ({sessionVehicle.year})
                          </p>
                        )}
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatSessionToDelete(session.id);
                          setShowDeleteChatModal(true);
                        }}
                        className="absolute bottom-4 right-4 p-2 text-revis-alert-critical hover:bg-revis-alert-critical/10 rounded-lg transition-colors z-10"
                        title={t('deleteChatAria')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              }
              {chatSessions.length === 0 && (
                <div className="text-center py-10 text-revis-gray">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhuma conversa encontrada.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle History Modal */}
      {showVehicleHistory && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('vehicleHistory')}</h2>
              <button onClick={() => setShowVehicleHistory(false)} className="text-revis-gray p-2">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-3">
              {archivedVehicles.map(vehicle => (
                <div 
                  key={vehicle.id} 
                  className="bg-revis-dark-gray rounded-xl p-4 border border-revis-gray/10 flex items-center gap-4"
                >
                  <div className="p-3 bg-revis-black/30 rounded-full flex-shrink-0 opacity-50">
                    {vehicle.type === 'Carro' && <Car className="w-5 h-5 text-revis-gray" />}
                    {vehicle.type === 'Moto' && <Bike className="w-5 h-5 text-revis-gray" />}
                    {vehicle.type === 'Bike' && <Zap className="w-5 h-5 text-revis-gray" />}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-revis-heading text-base truncate">{vehicle.brand} {vehicle.model} ({vehicle.year})</h3>
                    <p className="text-xs text-revis-gray truncate">
                      Excluído em: {vehicle.deleted_at ? formatAppDate(vehicle.deleted_at, dateFormat) : 'Data desconhecida'}
                    </p>
                  </div>

                  <button 
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setExpandedCards({ mileage: false, services: false, financial: false });
                      setShowVehicleHistory(false);
                      fetchLogs(vehicle.id);
                      fetchFinancialRecords(vehicle.id);
                    }}
                    className="text-xs text-revis-green font-medium whitespace-nowrap hover:underline"
                  >
                    {t('viewDetailsWithArrow')}
                  </button>
                </div>
              ))}
              
              {archivedVehicles.length === 0 && (
                <div className="text-center py-10 text-revis-gray">
                  <Archive className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>{t('noVehiclesArchived')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Vehicle Confirmation Modal */}
      {showDeleteVehicleModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 w-full max-w-sm border border-revis-gray/20 shadow-xl">
            <h3 className="text-xl font-bold text-revis-heading mb-6 text-center">{t('deleteVehicleTitle')}</h3>
            
            <div className="flex gap-3 mb-6">
              <button 
                onClick={confirmArchiveVehicle}
                className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
              <button 
                onClick={() => setShowDeleteVehicleModal(false)}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('no')}
              </button>
            </div>
            
            <p className="text-[10px] text-revis-gray text-center leading-relaxed">
              {t('deleteVehicleBackupNote')}
            </p>
          </div>
        </div>
      )}

      {/* Delete Chat Confirmation Modal */}
      {showDeleteChatModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 w-full max-w-sm border border-revis-gray/20 shadow-xl">
            <h3 className="text-xl font-bold text-revis-heading mb-6 text-center">{t('deleteChatTitle')}</h3>
            
            <div className="flex gap-3 mb-6">
              <button 
                onClick={confirmDeleteChatSession}
                className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
              <button 
                onClick={() => {
                  setShowDeleteChatModal(false);
                  setChatSessionToDelete(null);
                }}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('no')}
              </button>
            </div>
            
            <p className="text-[10px] text-revis-gray text-center leading-relaxed">
              {t('deleteChatFootnote')}
            </p>
          </div>
        </div>
      )}

      {/* Preferences Save Confirmation Modal */}
      {showPreferencesSaveConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20">
            <h3 className="text-xl font-bold text-revis-heading mb-2">{t('confirmChanges')}</h3>
            <p className="text-revis-gray mb-6 text-sm">{t('confirmChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowPreferencesSaveConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/10 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={() => {
                  // Modo imediato: as preferências já foram aplicadas; aqui apenas confirmamos
                  // o snapshot original como o novo "estado salvo".
                  setOriginalTheme(tempTheme);
                  setOriginalLanguage(tempLanguage);
                  setOriginalFontSize(tempFontSize);
                  setShowPreferencesSaveConfirmation(false);
                  setActiveTab('garage');
                }}
                className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences Cancel Confirmation Modal */}
      {showPreferencesCancelConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20">
            <h3 className="text-xl font-bold text-revis-heading mb-2">{t('cancelChanges')}</h3>
            <p className="text-revis-gray mb-6 text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowPreferencesCancelConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/10 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={() => {
                  // Reverter para o snapshot tirado ao entrar na tela
                  setTheme(originalTheme);
                  setLanguage(originalLanguage);
                  setFontSize(originalFontSize);
                  setDateFormat(originalDateFormat);
                  setCurrency(originalCurrency);
                  setHasManualDateFormat(originalHasManualDateFormat);
                  setTempTheme(originalTheme);
                  setTempLanguage(originalLanguage);
                  setTempFontSize(originalFontSize);
                  setTempDateFormat(originalDateFormat);
                  setTempCurrency(originalCurrency);
                  setShowPreferencesCancelConfirmation(false);
                  setActiveTab('garage');
                }}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Edit Modal */}
      {showProfileEdit && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('profileData')}</h2>
            </div>
            
            <form onSubmit={handleUpdateProfile} className="space-y-6">
              {/* Read-only fields */}
              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('name')}</label>
                <input 
                  readOnly
                  className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-4 text-revis-gray outline-none cursor-not-allowed"
                  value={user?.name || ''}
                />
              </div>
              
              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('birthDate')}</label>
                <input 
                  readOnly
                  className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-4 text-revis-gray outline-none cursor-not-allowed"
                  value={user?.birth_date ? formatAppDate(user.birth_date, dateFormat) : ''}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('country')}</label>
                <input 
                  readOnly
                  className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-4 text-revis-gray outline-none cursor-not-allowed"
                  value={user?.country || ''}
                />
              </div>

              {/* Editable fields */}
              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('nickname')}</label>
                <input 
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={profileForm.nickname}
                  onChange={e => setProfileForm({...profileForm, nickname: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('email')}</label>
                <input 
                  type="email"
                  required
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={profileForm.email}
                  onChange={e => setProfileForm({...profileForm, email: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('phone')}</label>
                <input 
                  required
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={profileForm.phone}
                  onChange={e => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 11) val = val.slice(0, 11);
                    val = val.replace(/^(\d{2})(\d)/, '($1) $2');
                    val = val.replace(/(\d{5})(\d)/, '$1-$2');
                    setProfileForm({...profileForm, phone: val});
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('zipCode')}</label>
                <input 
                  required
                  maxLength={9}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={profileForm.zip_code}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2');
                    setProfileForm({...profileForm, zip_code: val});
                  }}
                  onBlur={handleProfileCepBlur}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('city')}</label>
                  <input 
                    readOnly
                    className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-4 text-revis-gray outline-none cursor-not-allowed"
                    value={profileForm.city}
                  />
                </div>
                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('state')}</label>
                  <input 
                    readOnly
                    className="w-full bg-revis-dark-gray/50 border border-transparent rounded-xl p-4 text-revis-gray outline-none cursor-not-allowed"
                    value={profileForm.state}
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button 
                  type="button" 
                  onClick={handleCancelProfile}
                  className="w-full bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-4 rounded-xl hover:bg-revis-gray/20 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit" 
                  className="w-full bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  {t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Confirmation Modal */}
      {showSaveConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20">
            <h3 className="text-xl font-bold text-revis-heading mb-2">{t('confirmChanges')}</h3>
            <p className="text-revis-gray mb-6 text-sm">{t('confirmChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowSaveConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/10 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={confirmSaveProfile}
                className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20">
            <h3 className="text-xl font-bold text-revis-heading mb-2">{t('cancelChanges')}</h3>
            <p className="text-revis-gray mb-6 text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCancelConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/10 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={confirmCancelProfile}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences Save Confirmation Modal Removed */}

      {/* Preferences Cancel Confirmation Modal Removed */}

      {/* Terms Modal (Logged In) */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('terms')}</h2>
              <button onClick={() => { setShowTermsModal(false); setActiveTab('menu'); }} className="text-revis-green font-bold text-sm flex items-center gap-1 p-2">
                &lt; {t('back')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-revis-dark-gray rounded-xl p-4 text-xs text-revis-light-gray space-y-4">
              <h3 className="font-bold text-revis-heading mb-2 text-sm">TERMOS E CONDIÇÕES DE USO – PLATAFORMA REVISAUTO</h3>
              <p className="text-[10px] text-revis-gray mb-4">Última atualização: 17 de fevereiro de 2026.<br/>*novas atualizações serão notificadas por e-mail para novo aceite</p>
              
              <div className="bg-revis-alert-medium/10 border border-revis-alert-medium p-3 rounded-lg mb-4">
                <p className="text-revis-alert-medium font-bold text-[10px]">AVISO DE MAIORIDADE</p>
                <p className="text-[10px] mt-1">O RevisAuto é uma plataforma destinada exclusivamente a usuários maiores de 18 (dezoito) anos. Ao acessar ou utilizar este aplicativo, você declara possuir a idade mínima exigida e plena capacidade civil, compreendendo que a gestão e condução de veículos automotores e elétricos no Brasil requerem maioridade e habilitação legal específica.</p>
              </div>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">1. CADASTRO E SEGURANÇA DE DADOS (CONFORMIDADE LGPD)</h4>
              <p>1.1. Elegibilidade: O Usuário declara ser maior de 18 anos e ser o proprietário ou possuidor legítimo do veículo cadastrado.</p>
              <p>1.2. Veracidade das Informações: O Usuário é o único responsável pela precisão e atualização dos dados inseridos (quilometragem, datas de manutenção, histórico de reparos).</p>
              <p>1.3. Confidencialidade: As credenciais de acesso são pessoais e intransferíveis. O Usuário compromete-se a notificar a administração do RevisAuto imediatamente sobre qualquer uso não autorizado de sua conta.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">2. COMUNIDADE E REDE SOCIAL (DIRETRIZES DE CONDUTA)</h4>
              <p>2.1. Conteúdo Gerado pelo Usuário (UGC): O Usuário concede ao RevisAuto uma licença gratuita e global para exibir conteúdos postados em áreas comuns do app.</p>
              <p>2.2. Proibições: É proibida a publicação de conteúdo difamatório, obsceno, abusivo, ilegal ou propaganda não autorizada (SPAM).</p>
              <p>2.3. Moderação: O RevisAuto reserva-se o direito de remover conteúdos e banir usuários que violem estas diretrizes.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">3. PROPRIEDADE INTELECTUAL E PROTEÇÃO CONTRA PLÁGIO</h4>
              <p>3.1. Propriedade e Patenteamento: Todo o código-fonte, interface gráfica, algoritmos de IA e a marca RevisAuto são de propriedade exclusiva da desenvolvedora, protegidos por registro de software e patentes conforme aplicável.</p>
              <p>3.2. Proibição de Plágio: É terminantemente proibida a reprodução total ou parcial da lógica ou design da plataforma.</p>
              <p>3.3. Procedimentos Judiciais: A prática de plágio sujeitará o infrator a procedimentos judiciais nas esferas cível e criminal, incluindo indenizações por danos materiais e lucros cessantes.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">4. PROTOCOLOS DE SEGURANÇA E PREVENÇÃO A FRAUDES</h4>
              <p>4.1. Cuidado com Credenciais: O RevisAuto jamais solicitará sua senha de acesso por telefone, e-mail, SMS ou redes sociais. O compartilhamento de senhas com terceiros é de inteira responsabilidade do Usuário.</p>
              <p>4.2. Canais Oficiais de Cobrança: Todas as transações financeiras e cobranças de assinaturas são realizadas exclusivamente através de plataformas verificadas e integradas (App Store, Google Play ou gateways de pagamento seguros dentro do app).</p>
              <p>4.3. Alertas de Golpes: O RevisAuto não realiza cobranças nem solicita pagamentos via WhatsApp, ligações telefônicas, SMS ou links diretos enviados por e-mail. Caso receba solicitações de transferência (PIX, boletos ou cartões) fora do ambiente seguro do aplicativo, o Usuário deve ignorar e reportar o incidente.</p>
              <p>4.4. Isenção de Responsabilidade por Engenharia Social: O RevisAuto não se responsabiliza por prejuízos financeiros decorrentes de golpes de terceiros, phishing ou transferências realizadas pelo usuário para contas não oficiais.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">5. ASSINATURAS E PAGAMENTOS</h4>
              <p>5.1. Serviços Premium: Funcionalidades pagas estarão sujeitas a termos de recorrência apresentados no momento da contratação.</p>
              <p>5.2. Reajustes: Alterações de valores serão comunicadas com 30 (trinta) dias de antecedência.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">6. DISPONIBILIDADE E MODIFICAÇÕES</h4>
              <p>6.1. Interrupções de Serviço: O serviço pode sofrer instabilidades técnicas devido a provedores de nuvem terceiros.</p>
              <p>6.2. Alteração dos Termos: A continuidade do uso do app após atualizações constitui aceitação dos novos termos.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">7. NATUREZA DO SERVIÇO E ISENÇÃO DE RESPONSABILIDADE</h4>
              <p>7.1. Consultoria via IA: O Usuário reconhece que o RevisAuto fornece recomendações geradas por algoritmos com caráter meramente informativo e consultivo.</p>
              <p>7.2. Responsabilidade Técnica: A plataforma não substitui o manual do fabricante ou a avaliação de um profissional. O RevisAuto não se responsabiliza por danos decorrentes da aplicação de sugestões da IA.</p>
              <p>7.3. Dicas de Produtos: A compatibilidade de produtos químicos ou peças é de inteira responsabilidade do Usuário.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">8. FORO E LEGISLAÇÃO APLICÁVEL</h4>
              <p>8.1. Regido pelas leis da República Federativa do Brasil (Marco Civil da Internet e LGPD).</p>
              <p>8.2. Eleito o Foro da Comarca de Vila Velha, Estado do Espírito Santo.</p>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Modal (Logged In) */}
      {showPrivacyModal && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('privacy')}</h2>
              <button onClick={() => { setShowPrivacyModal(false); setActiveTab('menu'); }} className="text-revis-green font-bold text-sm flex items-center gap-1 p-2">
                &lt; {t('back')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-revis-dark-gray rounded-xl p-4 text-xs text-revis-light-gray space-y-4">
              <h3 className="font-bold text-revis-heading mb-2 text-sm">POLÍTICA DE PRIVACIDADE – REVISAUTO</h3>
              <p className="text-[10px] text-revis-gray mb-4">Última atualização: 17 de fevereiro de 2026.<br/>*novas atualizações serão notificadas por e-mail para novo aceite</p>
              
              <p>A plataforma RevisAuto tem o compromisso de proteger a privacidade e os dados pessoais de seus usuários. Esta Política descreve como coletamos, usamos, armazenamos e protegemos suas informações, em total conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).</p>
              
              <h4 className="font-bold text-revis-heading mt-4 text-sm">1. DADOS COLETADOS</h4>
              <p>Para o funcionamento das funcionalidades de consultoria e manutenção, coletamos:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Informações de Cadastro: Nome, e-mail e data de nascimento (para verificação de maioridade).</li>
                <li>Informações do Veículo: Marca, modelo, ano, quilometragem e histórico de serviços inseridos.</li>
                <li>Dados de Localização: Coletamos sua localização aproximada (cidade) para fornecer alertas climáticos específicos (ex: maresia e umidade).</li>
                <li>Dados de Mídia: Fotos de recibos ou fotos do veículo enviadas pelo usuário através da função de câmera.</li>
              </ul>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">2. FINALIDADE DO TRATAMENTO DE DADOS</h4>
              <p>Os dados são utilizados exclusivamente para:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Personalizar as recomendações da Inteligência Artificial.</li>
                <li>Gerar alertas de manutenção preventiva e estética automotiva.</li>
                <li>Garantir a segurança da conta e prevenir fraudes.</li>
                <li>Melhorar a experiência na comunidade e rede social do app.</li>
              </ul>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">3. COMPARTILHAMENTO DE DADOS</h4>
              <p>3.1. Não Comercialização: O RevisAuto não vende seus dados pessoais a terceiros.</p>
              <p>3.2. Parceiros Técnicos: Seus dados podem ser processados em servidores de nuvem (Google Cloud) e através da API de Inteligência Artificial do Google, que seguem padrões internacionais de segurança.</p>
              <p>3.3. Ordens Judiciais: Poderemos compartilhar dados caso sejamos obrigados por lei ou decisão judicial, conforme o Marco Civil da Internet.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">4. SEGURANÇA DA INFORMAÇÃO</h4>
              <p>4.1. Criptografia: Utilizamos criptografia SSL/TLS para o tráfego de dados entre o seu celular e nossos servidores.</p>
              <p>4.2. Armazenamento Seguro: Os dados são armazenados em bancos de dados protegidos por firewalls e controles de acesso rigorosos.</p>
              <p>4.3. Responsabilidade do Usuário: A segurança também depende de você. Mantenha sua senha em sigilo e não utilize o app em redes Wi-Fi públicas não seguras.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">5. SEUS DIREITOS (LGPD)</h4>
              <p>Como titular dos dados, você tem o direito de:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Confirmar a existência de tratamento de seus dados.</li>
                <li>Acessar seus dados a qualquer momento.</li>
                <li>Corrigir dados incompletos ou desatualizados.</li>
                <li>Portabilidade: Solicitar a exportação de seus dados para outros serviços.</li>
                <li>Exclusão (Direito ao Esquecimento): Solicitar a eliminação definitiva de todos os seus dados dos nossos servidores através das configurações do app.</li>
              </ul>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">6. COOKIES E TECNOLOGIAS DE RASTREIO</h4>
              <p>Utilizamos identificadores de dispositivos móveis para reconhecer seu aparelho e manter sua sessão ativa, além de ferramentas de análise (como Google Analytics) para entender como os usuários interagem com o app e melhorar as funcionalidades.</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">7. RETENÇÃO DE DADOS</h4>
              <p>Mantemos seus dados apenas pelo tempo necessário para cumprir as finalidades descritas nesta política ou conforme exigido por obrigações legais de guarda de registros (Marco Civil da Internet).</p>

              <h4 className="font-bold text-revis-heading mt-4 text-sm">8. CONTATO E ENCARREGADO DE DADOS (DPO)</h4>
              <p>Para exercer seus direitos ou tirar dúvidas sobre sua privacidade, entre em contato com nosso Encarregado de Proteção de Dados (DPO) através do e-mail oficial: suporte@revisautoapp.com.br.</p>
            </div>
          </div>
        </div>
      )}

      {showAddVehicle && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4 pb-24">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">{t('newVehicleTitle')}</h2>
            </div>
            
            <form onSubmit={handleAddVehicle} className="space-y-6">
              <div>
                <label className="block text-sm text-revis-gray mb-2">{t('vehicleType')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Carro', 'Moto', 'Bike'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setNewVehicle({...newVehicle, type: type as any, brand: '', model: ''});
                        setCustomBrand('');
                        setCustomModel('');
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-colors ${
                        newVehicle.type === type 
                          ? 'bg-revis-green/10 border-revis-green text-revis-green' 
                          : 'bg-revis-dark-gray border-transparent text-revis-gray'
                      }`}
                    >
                      {type === 'Carro' && <Car className="w-6 h-6" />}
                      {type === 'Moto' && <Bike className="w-6 h-6" />}
                      {type === 'Bike' && <Zap className="w-6 h-6" />}
                      <span className="text-xs font-medium">{type === 'Bike' ? t('eBikeTypeLabel') : type}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('brand')}</label>
                  <select 
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none appearance-none"
                    value={newVehicle.brand === 'Outra' ? 'Outra' : (newVehicle.brand || '')}
                    onChange={e => {
                      const val = e.target.value;
                      setNewVehicle({...newVehicle, brand: val, model: ''});
                      if (val !== 'Outra') setCustomBrand('');
                      setCustomModel('');
                    }}
                  >
                    <option value="">{t('selectPlaceholder')}</option>
                    {getBrandList().map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  
                  {newVehicle.brand === 'Outra' && (
                    <input 
                      required
                      className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors mt-2"
                      placeholder={t('vehicleBrandPlaceholder')}
                      value={customBrand}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                        setCustomBrand(val);
                      }}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('model')}</label>
                  {newVehicle.brand && newVehicle.brand !== 'Outra' && getModelList().length > 0 ? (
                    <>
                      <select 
                        required
                        className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none appearance-none"
                        value={newVehicle.model === 'Outro' ? 'Outro' : (newVehicle.model || '')}
                        onChange={e => {
                          const val = e.target.value;
                          setNewVehicle({...newVehicle, model: val});
                          if (val !== 'Outro') setCustomModel('');
                        }}
                      >
                        <option value="">{t('selectPlaceholder')}</option>
                        {getModelList().map(m => <option key={m} value={m}>{m}</option>)}
                        <option value="Outro">Outro</option>
                      </select>
                      {newVehicle.model === 'Outro' && (
                        <input 
                          required
                          className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors mt-2"
                          placeholder={t('vehicleModelPlaceholder')}
                          value={customModel}
                          onChange={e => {
                            const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                            setCustomModel(val);
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <input 
                      required
                      disabled={!newVehicle.brand}
                      className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={!newVehicle.brand ? t('vehicleModelSelectBrandFirst') : t('vehicleModelPlaceholder')}
                      value={newVehicle.brand === 'Outra' ? customModel : (newVehicle.model || '')}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                        if (newVehicle.brand === 'Outra') {
                          setCustomModel(val);
                        } else {
                          setNewVehicle({...newVehicle, model: val});
                        }
                      }}
                    />
                  )}
                </div>

                {/* Premium Fields */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm text-revis-gray">{t('nickname')}</label>
                    {user?.plan !== 'premium' && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
                        👑 Premium
                      </span>
                    )}
                  </div>
                  <div
                    onClick={() => {
                      if (user?.plan !== 'premium') {
                        setShowUpgradeModal(true);
                      }
                    }}
                  >
                    <input
                      className={`w-full bg-revis-dark-gray border border-transparent rounded-xl p-4 outline-none transition-colors ${
                        user?.plan === 'premium'
                          ? 'focus:border-revis-green text-revis-light-gray'
                          : 'text-revis-gray cursor-not-allowed opacity-60'
                      }`}
                      placeholder={user?.plan === 'premium' ? t('vehicleNicknamePremiumExample') : t('vehicleNicknamePremiumOnly')}
                      maxLength={12}
                      disabled={user?.plan !== 'premium'}
                      value={newVehicle.nickname || ''}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                        setNewVehicle({...newVehicle, nickname: val});
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm text-revis-gray">{t('color')}</label>
                    {user?.plan !== 'premium' && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
                        👑 Premium
                      </span>
                    )}
                  </div>
                  <div
                    onClick={() => {
                      if (user?.plan !== 'premium') {
                        setShowUpgradeModal(true);
                      }
                    }}
                  >
                    <select
                      className={`w-full bg-revis-dark-gray border border-transparent rounded-xl p-4 outline-none appearance-none transition-colors ${
                        user?.plan === 'premium'
                          ? 'focus:border-revis-green text-revis-light-gray'
                          : 'text-revis-gray cursor-not-allowed opacity-60'
                      }`}
                      disabled={user?.plan !== 'premium'}
                      value={newVehicle.color || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setNewVehicle({...newVehicle, color: val});
                        if (val !== 'Customizado') setCustomColor('');
                        if (val !== 'Outra') setOtherColor('');
                      }}
                    >
                      <option value="">{user?.plan === 'premium' ? t('selectPlaceholder') : t('vehicleNicknamePremiumOnly')}</option>
                      {user?.plan === 'premium' && VEHICLE_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {user?.plan === 'premium' && newVehicle.color === 'Customizado' && (
                      <input
                        className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors mt-2"
                        placeholder={t('vehicleCustomColorPlaceholder')}
                        maxLength={30}
                        value={customColor}
                        onChange={e => {
                          const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                          setCustomColor(val);
                        }}
                      />
                    )}

                    {user?.plan === 'premium' && newVehicle.color === 'Outra' && (
                      <input
                        className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors mt-2"
                        placeholder={t('vehicleColorPlaceholder')}
                        maxLength={10}
                        value={otherColor}
                        onChange={e => {
                          const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                          setOtherColor(val);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('year')}</label>
                  <select 
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none appearance-none"
                    value={newVehicle.year || ''}
                    onChange={e => setNewVehicle({...newVehicle, year: parseInt(e.target.value)})}
                  >
                    {Array.from({length: new Date().getFullYear() - 1950 + 1}, (_, i) => new Date().getFullYear() - i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-revis-gray mb-1">{t('currentKmLabel')}</label>
                  <input 
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={mileageInput}
                    placeholder={t('mileagePlaceholderZero')}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      const formatted = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                      setMileageInput(formatted);
                      setNewVehicle({...newVehicle, current_mileage: parseInt(val || '0')});
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('lastGeneralRevision')}</label>
                <input 
                  type="date"
                  required
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newVehicle.last_service_date || ''}
                  onChange={e => setNewVehicle({...newVehicle, last_service_date: e.target.value})}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={handleCancelAddVehicle}
                  disabled={isSubmittingVehicle}
                  className="flex-1 bg-revis-dark-gray text-revis-heading font-bold py-4 rounded-xl hover:bg-revis-gray/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmittingVehicle}
                  className="flex-1 bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingVehicle ? t('saving') : t('addButton')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddLog && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">
                {editingMaintenanceLogId !== null ? t('editMaintenanceTitle') : t('newMaintenanceTitle')}
              </h2>
              <div className="flex items-center gap-1">
                {editingMaintenanceLogId !== null && (
                  <button
                    type="button"
                    onClick={handleDeleteLog}
                    disabled={isDeletingRecord || isSubmittingLog}
                    aria-label={t('deleteRecord')}
                    className="text-revis-alert-critical hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeLogModal} className="text-revis-gray p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleAddLog} className="space-y-6">
              <div>
                <label className="block text-sm text-revis-gray mb-1">Descrição</label>
                <input 
                  required
                  placeholder={t('logDescriptionPlaceholder')}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newLog.description || ''}
                  onChange={e => setNewLog({...newLog, description: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">Responsável</label>
                <input 
                  placeholder={t('logProviderPlaceholder')}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newLog.provider || ''}
                  onChange={e => setNewLog({...newLog, provider: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-revis-gray mb-1">Data</label>
                  <input 
                    type="date"
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={newLog.date || ''}
                    onChange={e => setNewLog({...newLog, date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm text-revis-gray mb-1">Custo (R$)</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={newLog.cost ?? ''}
                    onChange={e => setNewLog({...newLog, cost: parseFloat(e.target.value)})}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingLog || isDeletingRecord}
                className="w-full bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingLog
                  ? t('saving')
                  : editingMaintenanceLogId !== null
                  ? t('saveChanges')
                  : t('registerServiceButton')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Financial Record Modal */}
      {showAddFinancial && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">
                {editingFinancialRecordId !== null ? t('editFinancialTitle') : 'Novo Registro Financeiro'}
              </h2>
              <div className="flex items-center gap-1">
                {editingFinancialRecordId !== null && (
                  <button
                    type="button"
                    onClick={handleDeleteFinancial}
                    disabled={isDeletingRecord || isSubmittingFinancial}
                    aria-label={t('deleteRecord')}
                    className="text-revis-alert-critical hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeFinancialModal} className="text-revis-gray p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleAddFinancial} className="space-y-6">
              <div>
                <label className="block text-sm text-revis-gray mb-2">Tipo</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Imposto', 'Multa', 'Taxa'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={isSubmittingFinancial}
                      onClick={() => setNewFinancial({...newFinancial, type: type as any})}
                      className={`p-3 rounded-xl border flex items-center justify-center transition-colors ${
                        newFinancial.type === type 
                          ? 'bg-revis-green/10 border-revis-green text-revis-green' 
                          : 'bg-revis-dark-gray border-transparent text-revis-gray'
                      }`}
                    >
                      <span className="text-sm font-medium">{type}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">Descrição</label>
                <input 
                  required
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newFinancial.description || ''}
                  onChange={e => setNewFinancial({...newFinancial, description: e.target.value})}
                  placeholder={t('financialDescPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-revis-gray mb-1">Vencimento</label>
                  <input 
                    type="date"
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={newFinancial.due_date || ''}
                    onChange={e => setNewFinancial({...newFinancial, due_date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm text-revis-gray mb-1">Valor (R$)</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={newFinancial.value ?? ''}
                    onChange={e => setNewFinancial({...newFinancial, value: parseFloat(e.target.value)})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-2">Situação</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Pago', 'Em aberto', 'Atrasado'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={isSubmittingFinancial}
                      onClick={() => setNewFinancial({...newFinancial, status: status as any})}
                      className={`p-3 rounded-xl border flex items-center justify-center transition-colors ${
                        newFinancial.status === status 
                          ? status === 'Pago' ? 'bg-revis-green/10 border-revis-green text-revis-green' : status === 'Atrasado' ? 'bg-revis-alert-critical/10 border-revis-alert-critical text-revis-alert-critical' : 'bg-revis-alert-medium/10 border-revis-alert-medium text-revis-alert-medium'
                          : 'bg-revis-dark-gray border-transparent text-revis-gray'
                      }`}
                    >
                      <span className="text-sm font-medium">{status}</span>
                    </button>
                  ))}
                </div>
              </div>

              {newFinancial.status === 'Pago' && (
                <div>
                  <label className="block text-sm text-revis-gray mb-1">Data de Pagamento</label>
                  <input 
                    type="date"
                    required
                    className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                    value={newFinancial.payment_date || ''}
                    onChange={e => setNewFinancial({...newFinancial, payment_date: e.target.value})}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-revis-gray mb-1">Observações (Opcional)</label>
                <textarea 
                  maxLength={200}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors resize-none h-24"
                  value={newFinancial.notes || ''}
                  onChange={e => setNewFinancial({...newFinancial, notes: e.target.value})}
                  placeholder={t('financialNotesPlaceholder')}
                />
                <div className="text-right text-xs text-revis-gray mt-1">
                  {(newFinancial.notes?.length || 0)}/200
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingFinancial || isDeletingRecord}
                className="w-full bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingFinancial
                  ? t('saving')
                  : editingFinancialRecordId !== null
                  ? t('saveChanges')
                  : t('saveFinancialRecord')}
              </button>
            </form>
          </div>
        </div>
      )}
      {showAddMileage && (
        <div className="fixed inset-0 bg-revis-black z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-revis-heading">
                {editingMileageLogId ? t('editMileageTitle') : 'Novo Registro de Km'}
              </h2>
              <div className="flex items-center gap-1">
                {editingMileageLogId && (
                  <button
                    type="button"
                    onClick={handleDeleteMileage}
                    disabled={isDeletingRecord || isSubmittingMileage}
                    aria-label={t('deleteRecord')}
                    className="text-revis-alert-critical hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeMileageModal} className="text-revis-gray p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>

            <form onSubmit={handleMileageSubmit} className="space-y-6">
              <div>
                <label className="block text-sm text-revis-gray mb-1">Data</label>
                <input 
                  type="date"
                  required
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newMileage.date || ''}
                  onChange={e => setNewMileage({...newMileage, date: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-revis-gray mb-1">{t('currentKmLabel')}</label>
                <input 
                  required
                  placeholder={t('mileagePlaceholderZero')}
                  className="w-full bg-revis-dark-gray border border-transparent focus:border-revis-green rounded-xl p-4 text-revis-light-gray outline-none transition-colors"
                  value={newMileage.mileage || ''}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '');
                    const formatted = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                    setNewMileage({...newMileage, mileage: formatted});
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingMileage || isDeletingRecord}
                className="w-full bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingMileage
                  ? t('saving')
                  : editingMileageLogId
                  ? t('saveChanges')
                  : t('addButton')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* View Record Modal (read-only) */}
      {isViewModalOpen && viewingRecord && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={closeViewRecord}
        >
          <div
            className="bg-revis-dark-gray rounded-2xl p-6 max-w-md w-full border border-revis-gray/20 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-5">
              <h3 className="text-xl font-bold text-revis-green">
                {viewingRecord.kind === 'mileage' && t('viewMileageTitle')}
                {viewingRecord.kind === 'maintenance' && t('viewMaintenanceTitle')}
                {viewingRecord.kind === 'financial' && t('viewFinancialTitle')}
              </h3>
              <button
                type="button"
                onClick={closeViewRecord}
                aria-label={t('closeButton')}
                className="text-revis-gray hover:text-revis-light-gray p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="space-y-4 text-sm max-h-[60vh] overflow-y-auto pr-1">
              {viewingRecord.kind === 'mileage' && (
                <>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('date')}</dt>
                    <dd className="text-revis-light-gray">{formatAppDate(viewingRecord.data.date, dateFormat)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('km')}</dt>
                    <dd className="text-revis-light-gray font-semibold">{(viewingRecord.data.mileage || 0).toLocaleString()} km</dd>
                  </div>
                </>
              )}

              {viewingRecord.kind === 'maintenance' && (
                <>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('date')}</dt>
                    <dd className="text-revis-light-gray">{formatAppDate(viewingRecord.data.date, dateFormat)}</dd>
                  </div>
                  {viewingRecord.data.type && (
                    <div>
                      <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('typeLabel')}</dt>
                      <dd className="text-revis-light-gray">{viewingRecord.data.type}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('descriptionLabel')}</dt>
                    <dd className="text-revis-light-gray whitespace-pre-wrap break-words">{viewingRecord.data.description || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('responsible')}</dt>
                    <dd className="text-revis-light-gray break-words">{viewingRecord.data.provider || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('value')}</dt>
                    <dd className="text-revis-green font-semibold">{formatAppCurrency(viewingRecord.data.cost, currency, language)}</dd>
                  </div>
                </>
              )}

              {viewingRecord.kind === 'financial' && (
                <>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('typeLabel')}</dt>
                    <dd className="text-revis-light-gray">{viewingRecord.data.type}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('descriptionLabel')}</dt>
                    <dd className="text-revis-light-gray whitespace-pre-wrap break-words">{viewingRecord.data.description || '-'}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('dueDateLabel')}</dt>
                      <dd className="text-revis-light-gray">{formatAppDate(viewingRecord.data.due_date, dateFormat)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('statusLabel')}</dt>
                      <dd className={`font-semibold ${
                        viewingRecord.data.status === 'Pago'
                          ? 'text-revis-green'
                          : viewingRecord.data.status === 'Atrasado'
                          ? 'text-revis-alert-critical'
                          : 'text-revis-alert-medium'
                      }`}>
                        {viewingRecord.data.status}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('value')}</dt>
                    <dd className="text-revis-green font-semibold">{formatAppCurrency(viewingRecord.data.value, currency, language)}</dd>
                  </div>
                  {viewingRecord.data.payment_date && (
                    <div>
                      <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('paymentDateLabel')}</dt>
                      <dd className="text-revis-light-gray">{formatAppDate(viewingRecord.data.payment_date, dateFormat)}</dd>
                    </div>
                  )}
                  {viewingRecord.data.notes && (
                    <div>
                      <dt className="text-xs text-revis-gray uppercase tracking-wider mb-1">{t('notesLabel')}</dt>
                      <dd className="text-revis-light-gray whitespace-pre-wrap break-words">{viewingRecord.data.notes}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>

            <div className="mt-6">
              <button
                type="button"
                onClick={closeViewRecord}
                className="w-full bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('closeButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Modal */}
      {isSupportModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={closeSupportModal}
        >
          <div
            className="bg-revis-dark-gray rounded-2xl p-6 max-w-md w-full border border-revis-gray/20 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-2">
                {supportMethod !== null && (
                  <button
                    type="button"
                    onClick={() => setSupportMethod(null)}
                    aria-label={t('back')}
                    className="text-revis-gray hover:text-revis-light-gray p-1 rounded-lg transition-colors -ml-1"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <h3 className="text-xl font-bold text-revis-green">
                  {supportMethod === 'email'
                    ? t('supportEmailTitle')
                    : supportMethod === 'whatsapp'
                    ? t('supportWhatsappTitle')
                    : t('supportTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeSupportModal}
                aria-label={t('closeButton')}
                className="text-revis-gray hover:text-revis-light-gray p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {supportMethod === null && (
              <div className="space-y-5">
                <p className="text-sm text-revis-light-gray">
                  {t('supportChooseMethod')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSupportMethod('email')}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-revis-gray/30 bg-revis-black/30 hover:bg-revis-gray/10 hover:border-revis-gray/60 transition-colors"
                  >
                    <Mail className="w-8 h-8 text-revis-light-gray" />
                    <span className="font-medium text-revis-heading">{t('supportEmail')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupportMethod('whatsapp')}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-revis-gray/30 bg-revis-black/30 hover:bg-revis-gray/10 hover:border-revis-gray/60 transition-colors"
                  >
                    <WhatsAppIcon className="w-8 h-8 text-[#25D366]" />
                    <span className="font-medium text-revis-heading">{t('supportWhatsapp')}</span>
                  </button>
                </div>
              </div>
            )}

            {supportMethod === 'email' && (
              <div className="space-y-5">
                <p className="text-sm text-revis-light-gray">
                  {t('supportEmailDesc')}
                </p>
                <a
                  href="mailto:suporte@revisautoapp.com.br"
                  className="w-full inline-flex items-center justify-center gap-2 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  <Mail className="w-5 h-5" />
                  {t('supportEmailCta')}
                </a>
              </div>
            )}

            {supportMethod === 'whatsapp' && (
              <div className="space-y-5">
                <p className="text-sm text-revis-light-gray">
                  {t('supportWhatsappDesc')}
                </p>
                <a
                  href="https://wa.me/5511918540985"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  <WhatsAppIcon className="w-5 h-5" />
                  {t('supportWhatsappCta')}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Preferences Confirmation Modal Removed */}
      {/* Cancel Preferences Confirmation Modal Removed */}

      {/* No Changes Modal Removed */}

      {/* Cancel Add Vehicle Confirmation Modal */}
      {showCancelAddVehicleConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20">
            <h3 className="text-xl font-bold text-revis-heading mb-2">{t('confirmCancelAddVehicle')}</h3>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowCancelAddVehicleConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/10 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmCancelAddVehicle}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Confirmation Modal */}
      {showEditConfirmation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20 shadow-xl">
            <h3 className="text-lg font-bold text-revis-heading mb-2">{t('confirmChanges')}</h3>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowEditConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmSave}
                className="flex-1 bg-revis-green text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Edit Confirmation Modal */}
      {showCancelEditConfirmation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20 shadow-xl">
            <h3 className="text-lg font-bold text-revis-heading mb-2">{t('cancelChanges')}</h3>
            <p className="text-revis-gray text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowCancelEditConfirmation(false)}
                className="flex-1 bg-revis-dark-gray border border-revis-gray/30 text-revis-light-gray font-bold py-3 rounded-xl hover:bg-revis-gray/20 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmCancel}
                className="flex-1 bg-revis-alert-critical text-white font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-revis-dark-gray rounded-2xl p-6 max-w-sm w-full border border-revis-gray/20 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-revis-green via-revis-green/70 to-revis-green"></div>

            <div className="flex justify-center mb-4">
              <div className="bg-revis-green/10 p-4 rounded-full">
                <Crown className="w-10 h-10 text-revis-green fill-revis-green" />
              </div>
            </div>
            
            <h3 className="text-2xl font-bold text-revis-heading mb-2 text-center">{t('premiumModalTitle')}</h3>
            <p className="text-revis-gray mb-6 text-sm text-center leading-relaxed">
              {t('premiumModalSubtitle')}
            </p>

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm text-revis-light-gray">
                <Check className="w-5 h-5 text-revis-green flex-shrink-0" />
                <span>{t('premiumFeatureGarage')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-revis-light-gray">
                <Check className="w-5 h-5 text-revis-green flex-shrink-0" />
                <span>{t('premiumFeatureDr')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-revis-light-gray">
                <Check className="w-5 h-5 text-revis-green flex-shrink-0" />
                <span>{t('premiumFeatureFinance')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-revis-light-gray">
                <Check className="w-5 h-5 text-revis-green flex-shrink-0" />
                <span>{t('premiumFeatureHistory')}</span>
              </div>
            </div>

            <div className="bg-revis-black/30 rounded-xl p-4 mb-6 text-center border border-revis-gray/10">
              <span className="text-xs text-revis-gray block mb-1">{t('premiumSubscriptionLabel')}</span>
              <div className="flex items-end justify-center gap-1">
                <span className="text-3xl font-bold text-revis-heading">R$ 29,90</span>
                <span className="text-sm text-revis-gray mb-1">{t('premiumPerMonth')}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={handleNativePurchase}
                disabled={isUpgrading}
                className="w-full bg-revis-green text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors shadow-lg shadow-revis-green/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isUpgrading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                    {t('loading')}
                  </>
                ) : (
                  <>
                    <Crown className="w-5 h-5 fill-black" />
                    {t('premiumSubscribeNow')}
                  </>
                )}
              </button>
              <button 
                onClick={() => setShowUpgradeModal(false)}
                disabled={isUpgrading}
                className="w-full bg-transparent text-revis-gray font-medium py-3 rounded-xl hover:text-revis-light-gray transition-colors text-sm"
              >
                {t('premiumMaybeLater')}
              </button>
            </div>
            
            <p className="text-[10px] text-revis-gray text-center mt-4">
              {t('premiumFooterNote')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
