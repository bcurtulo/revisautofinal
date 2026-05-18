import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Deep link / retorno Mercado Pago: defina MP_BACK_URL no backend com o mesmo
 * esquema (ex.: revisautoapp://checkout/return). Android/iOS registram revisautoapp
 * em AndroidManifest e Info.plist. Para reagir à URL no JS (navegação pós-pagamento),
 * use @capacitor/app: App.addListener('appUrlOpen', ...).
 */
const config: CapacitorConfig = {
  appId: 'br.com.revisautoapp',
  appName: 'RevisAuto',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
