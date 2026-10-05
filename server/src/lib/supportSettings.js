export function normalizePublicUrl(value) {
  if (value === null || value === undefined) return null;
  const resolved = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!resolved) return null;
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(resolved) ? resolved : `https://${resolved}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizePublicLinks(raw = []) {
  const normalizeIncoming = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === 'null') return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const source = normalizeIncoming(raw);
  const links = source
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name ?? item.label ?? '').trim();
      const url = normalizePublicUrl(item.url ?? item.href ?? item.link ?? null);
      const description = String(item.description ?? '').trim();
      const enabledValue = item.enabled ?? item.isEnabled ?? item.active ?? true;
      const displayOrder = Number(item.displayOrder ?? item.display_order ?? index + 1);
      const target = item.target === '_self' ? '_self' : '_blank';
      if (!name || !url) return null;
      return {
        name,
        url,
        description,
        enabled: enabledValue === true || enabledValue === 'true',
        displayOrder: Number.isFinite(displayOrder) ? displayOrder : index + 1,
        target,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0));

  return links;
}

export function normalizeSupportSettings(raw = {}) {
  const normalizeBoolean = (value, fallback = true) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true';
    return fallback;
  };

  const normalizeJsonString = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : value;
    } catch {
      return value;
    }
  };

  const normalizeUrl = (value) => normalizePublicUrl(value);

  const normalizeWhatsAppNumber = (value) => {
    const resolved = String(value ?? '').trim();
    if (!resolved) return null;
    const digits = resolved.replace(/\D/g, '');
    if (!digits) return null;
    return digits;
  };

  const buildWhatsAppUrl = (number, message) => {
    const normalizedNumber = normalizeWhatsAppNumber(number);
    if (!normalizedNumber) return null;
    const safeMessage = String(message ?? '').trim();
    const url = new URL(`https://wa.me/${normalizedNumber}`);
    if (safeMessage) {
      url.searchParams.set('text', safeMessage);
    }
    return url.toString();
  };

  const normalizeWelcomeNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  };
  const normalizeWelcomeImageUrl = (value) => {
    const resolved = typeof value === 'string' ? value.trim() : '';
    if (/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(resolved)) {
      return resolved;
    }
    if (resolved.startsWith('/')) return null;
    return normalizeUrl(value);
  };
  const customerSupportUrl = normalizeUrl(raw.customerSupportUrl ?? raw.customer_support_url ?? null);
  const officialGroupUrl = normalizeUrl(raw.officialGroupUrl ?? raw.official_group_url ?? null);
  const whatsappNumber = normalizeWhatsAppNumber(raw.whatsappNumber ?? raw.whatsapp_number ?? null);
  const whatsappUrl = normalizeUrl(raw.whatsappUrl ?? raw.whatsapp_url ?? null) ?? buildWhatsAppUrl(whatsappNumber, raw.whatsappMessage ?? raw.whatsapp_message ?? null);

  return {
    siteName: raw.siteName ?? raw.site_name ?? 'MKM',
    supportName: raw.supportName ?? raw.support_name ?? 'Customer Support',
    supportPhone: raw.supportPhone ?? raw.support_phone ?? null,
    supportMessage: raw.supportMessage ?? raw.support_message ?? 'We are here to help you.',
    supportEnabled: normalizeBoolean(raw.supportEnabled ?? raw.support_enabled, true),
    customerSupportUrl: customerSupportUrl,
    customerSupportLabel: raw.customerSupportLabel ?? raw.customer_support_label ?? 'Customer Support',
    customerSupportEnabled: normalizeBoolean(raw.customerSupportEnabled ?? raw.customer_support_enabled, true),
    whatsappNumber,
    whatsappUrl,
    whatsappEnabled: normalizeBoolean(raw.whatsappEnabled ?? raw.whatsapp_enabled, true),
    whatsappMessage: raw.whatsappMessage ?? raw.whatsapp_message ?? 'Hello',
    officialGroupName: raw.officialGroupName ?? raw.official_group_name ?? 'Official Group',
    officialGroupUrl: officialGroupUrl,
    officialGroupLabel: raw.officialGroupLabel ?? raw.official_group_label ?? 'Official Group',
    officialGroupEnabled: normalizeBoolean(raw.officialGroupEnabled ?? raw.official_group_enabled, true),
    appDownloadUrl: normalizeUrl(raw.appDownloadUrl ?? raw.app_download_url ?? null),
    aboutTitle: raw.aboutTitle ?? raw.about_title ?? 'One place for your member activity.',
    aboutIntro: raw.aboutIntro ?? raw.about_intro ?? 'MKM brings account access, wallet records, product information, referrals and support into a single member experience.',
    aboutFirstHeading: raw.aboutFirstHeading ?? raw.about_first_heading ?? 'Account-led',
    aboutFirstContent: raw.aboutFirstContent ?? raw.about_first_content ?? 'Members sign in with a phone number and can review account activity from the dashboard.',
    aboutSecondHeading: raw.aboutSecondHeading ?? raw.about_second_heading ?? 'Clear records',
    aboutSecondContent: raw.aboutSecondContent ?? raw.about_second_content ?? 'Wallet and transaction activity is recorded by the MKM service and shown in the member portal.',
    welcomeEyebrow: raw.welcomeEyebrow ?? raw.welcome_eyebrow ?? 'YOUR MEMBER JOURNEY STARTS HERE',
    welcomeTitle: raw.welcomeTitle ?? raw.welcome_title ?? 'Welcome to MKM',
    welcomeIntro: raw.welcomeIntro ?? raw.welcome_intro ?? 'We’re glad you’re here. Explore your account, products, and member benefits from one place.',
    welcomeBonusLabel: raw.welcomeBonusLabel ?? raw.welcome_bonus_label ?? 'Welcome bonus',
    welcomeExampleTitle: raw.welcomeExampleTitle ?? raw.welcome_example_title ?? 'PRODUCT EXAMPLE',
    welcomeExamplePrice: normalizeWelcomeNumber(raw.welcomeExamplePrice ?? raw.welcome_example_price, 300),
    welcomeExampleDailyEarnings: normalizeWelcomeNumber(raw.welcomeExampleDailyEarnings ?? raw.welcome_example_daily_earnings, 72),
    welcomeDisclaimer: raw.welcomeDisclaimer ?? raw.welcome_disclaimer ?? 'Illustrative example only. Actual product terms and earnings depend on the product details shown before purchase.',
    welcomeImageUrl: normalizeWelcomeImageUrl(raw.welcomeImageUrl ?? raw.welcome_image_url ?? null),
    welcomeImageAlt: raw.welcomeImageAlt ?? raw.welcome_image_alt ?? 'MKM welcome illustration with a rising plant and gift box',
    welcomeHomeButtonLabel: raw.welcomeHomeButtonLabel ?? raw.welcome_home_button_label ?? 'Go to Home',
    publicLinks: normalizePublicLinks(raw.publicLinks ?? raw.public_links ?? []),
  };
}
