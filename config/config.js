// ============================================
// SCRIPTIQ — CONFIGURABLE VARIABLES
// Never hardcode these values!
// ============================================

const CONFIG = {
  // Supabase
  SUPABASE_URL: 'https://ilkwsanblbsabtgipbom.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_gHRl7TnHyYYR4OnSubjXBA_n8pshdwH',

  // Paystack
  PAYSTACK_PUBLIC_KEY: 'pk_test_3563f8e525e91d3aaaa25ff79bfb6a44b0f3a03c',

  // Pricing (in Kobo — multiply by 100 for Paystack)
  PLANS: {
    free: {
      name: 'Free',
      price: 0,
      credits: 3,
      currency: 'NGN'
    },
    starter: {
      name: 'Starter',
      price: 250000, // ₦2,500 in kobo
      credits: 80,
      currency: 'NGN'
    },
    pro: {
      name: 'Pro',
      price: 800000, // ₦8,000 in kobo
      credits: 300,
      currency: 'NGN'
    }
  },

  // Credit costs per action
  CREDIT_COSTS: {
    script_breakdown: 1,
    shooting_schedule: 1,
    call_sheet: 1,
    production_budget: 1,
    shot_list: 1
  },

  // Supported languages
  LANGUAGES: [
    { code: 'en', name: 'English', dir: 'ltr', flag: '🇬🇧' },
    { code: 'fr', name: 'Français', dir: 'ltr', flag: '🇫🇷' },
    { code: 'es', name: 'Español', dir: 'ltr', flag: '🇪🇸' },
    { code: 'pt', name: 'Português', dir: 'ltr', flag: '🇵🇹' },
    { code: 'de', name: 'Deutsch', dir: 'ltr', flag: '🇩🇪' },
    { code: 'it', name: 'Italiano', dir: 'ltr', flag: '🇮🇹' },
    { code: 'tr', name: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
    { code: 'ar', name: 'العربية', dir: 'rtl', flag: '🇸🇦' },
    { code: 'zh', name: '中文', dir: 'ltr', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', dir: 'ltr', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', dir: 'ltr', flag: '🇰🇷' },
    { code: 'hi', name: 'हिन्दी', dir: 'ltr', flag: '🇮🇳' },
    { code: 'yo', name: 'Yorùbá', dir: 'ltr', flag: '🇳🇬' }
  ]
};

module.exports = CONFIG;
