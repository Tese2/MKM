import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from './services/api.js';
import { getProductImage } from './productImages.js';

const navigation = [
  { to: '/', label: 'Home' },
  { to: '/products', label: 'Products' },
  { to: '/about', label: 'About' },
  { to: '/support', label: 'Support' },
];

const money = (amount) => `${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
const rateFraction = (rate) => {
  const value = Number(rate ?? 0);
  return value > 1 ? value / 100 : value;
};

export default function PublicWebsite({ appDownloadUrl, user, onPurchase, busy }) {
  const location = useLocation();
  const productId = location.pathname.split('/').filter(Boolean).at(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/config/public').then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setError('');
    if (location.pathname === '/products') {
      setLoading(true);
      api('/products').then(setProducts).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
    } else if (location.pathname.startsWith('/products/')) {
      setLoading(true);
      setProduct(null);
      api(`/products/${productId}`).then(setProduct).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
    }
  }, [location.pathname, productId]);

  const title = config?.siteName || 'MKM';
  const downloadUrl = appDownloadUrl || config?.appDownloadUrl;
  const page = location.pathname;

  return (
    <div className='public-site'>
      <header className='public-header'>
        <Link className='public-brand' to='/' aria-label={`${title} home`}>
          <span className='brand-mark'>M</span>
          <span>{title}<small>MEMBER PLATFORM</small></span>
        </Link>
        <button
          className='public-menu-toggle'
          type='button'
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          aria-controls='public-navigation'
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav id='public-navigation' className={`public-navigation ${menuOpen ? 'is-open' : ''}`} aria-label='Public navigation'>
          {navigation.map((item) => <Link key={item.to} to={item.to} aria-current={page === item.to ? 'page' : undefined}>{item.label}</Link>)}
          <Link className='public-login' to='/login'>Login</Link>
          <Link className='public-register' to='/register'>Register <ArrowRight size={15} /></Link>
          {downloadUrl && <a className='public-download' href={downloadUrl} target='_blank' rel='noreferrer'><ArrowDownToLine size={15} /> Download App</a>}
        </nav>
      </header>

      <main className='public-main'>
        {page === '/' && <HomePage downloadUrl={downloadUrl} />}
        {page === '/about' && <AboutPage config={config} />}
        {page === '/products' && <ProductsPage products={products} loading={loading} error={error} user={user} onPurchase={onPurchase} busy={busy} />}
        {page.startsWith('/products/') && <ProductPage product={product} loading={loading} error={error} user={user} onPurchase={onPurchase} busy={busy} />}
        {page === '/support' && <SupportPage config={config} />}
        {page === '/download' && <DownloadPage url={downloadUrl} />}
        {page === '/forgot-password' && <RecoveryPage config={config} />}
        {page === '/terms' && <TermsPage />}
        {page === '/privacy' && <PrivacyPage />}
      </main>

      <footer className='public-footer'>
        <Link className='public-brand' to='/'><span className='brand-mark'>M</span><span>{title}<small>MEMBER PLATFORM</small></span></Link>
        <p>Account, wallet and product services in one place.</p>
        <nav aria-label='Legal and help links'><Link to='/terms'>Terms</Link><Link to='/privacy'>Privacy</Link><Link to='/support'>Support</Link></nav>
      </footer>
    </div>
  );
}

function HomePage({ downloadUrl }) {
  return (
    <>
      <section className='public-hero'>
        <div className='public-hero-copy'>
          <p className='eyebrow'>A CLEARER WAY FORWARD</p>
          <h1>Make your next move with MKM.</h1>
          <p>Explore available products, manage your account and keep your activity together in one secure member platform.</p>
          <div className='public-hero-actions'><Link className='public-primary' to='/register'>Create an account <ArrowRight size={16} /></Link><Link className='public-secondary' to='/products'>Explore products</Link></div>
        </div>
        <div className='public-hero-art' aria-hidden='true'>
          <div className='hero-index'>MKM / 01</div>
          <div className='hero-orbit hero-orbit-one' />
          <div className='hero-orbit hero-orbit-two' />
          <div className='hero-monogram'>M</div>
          <div className='hero-caption'>MEMBERSHIP<br />BEGINS HERE</div>
        </div>
      </section>
      <section className='public-section public-benefits'>
        <div><p className='eyebrow'>THE MEMBER EXPERIENCE</p><h2>Everything starts with a clear view.</h2></div>
        <div className='public-benefit-grid'>
          <article><span>01</span><h3>Your account</h3><p>Access your account, wallet activity and important updates from one place.</p></article>
          <article><span>02</span><h3>Available products</h3><p>Review product details and availability before signing in to make a purchase.</p></article>
          <article><span>03</span><h3>People and support</h3><p>Keep up with your referral team and reach MKM support when you need help.</p></article>
        </div>
      </section>
      {downloadUrl && <section className='public-download-band'><div><p className='eyebrow'>MKM ON YOUR DEVICE</p><h2>Take your account with you.</h2></div><a className='public-primary' href={downloadUrl} target='_blank' rel='noreferrer'><ArrowDownToLine size={16} /> Download App</a></section>}
    </>
  );
}

function AboutPage({ config }) {
  return <article className='public-copy-page'><p className='eyebrow'>ABOUT MKM</p><h1>{config?.aboutTitle || 'One place for your member activity.'}</h1><p className='about-copy'>{config?.aboutIntro || 'MKM brings account access, wallet records, product information, referrals and support into a single member experience.'}</p><div className='public-copy-columns'><section><h2>{config?.aboutFirstHeading || 'Account-led'}</h2><p className='about-copy'>{config?.aboutFirstContent || 'Members sign in with a phone number and can review account activity from the dashboard.'}</p></section><section><h2>{config?.aboutSecondHeading || 'Clear records'}</h2><p className='about-copy'>{config?.aboutSecondContent || 'Wallet and transaction activity is recorded by the MKM service and shown in the member portal.'}</p></section></div><Link className='public-primary' to='/products'>View products <ArrowRight size={16} /></Link></article>;
}

function ProductsPage({ products, loading, error, user, onPurchase, busy }) {
  return (
    <section className='public-catalog'>
      <div className='public-section-heading'><div><p className='eyebrow'>PRODUCT CATALOG</p><h1>Explore products</h1></div><p>Review current availability and product terms before purchasing.</p></div>
      {loading ? <p className='public-state' role='status'>Loading products…</p> : error ? <p className='public-state public-error' role='alert'>{error}</p> : products.length ? (
        <div className='public-product-grid'>{products.map((item) => <ProductCard key={item.id} product={item} user={user} onPurchase={onPurchase} busy={busy} />)}</div>
      ) : <p className='public-state'>There are no products available to display right now.</p>}
    </section>
  );
}

function ProductCard({ product, user, onPurchase, busy }) {
  const price = Number(product.price ?? 0);
  const normalizedRate = rateFraction(product.dailyRate ?? 0.24);
  const dailyIncome = price * normalizedRate;
  const isComingSoon = product.status === 'COMING_SOON' || (product.availableFrom && new Date(product.availableFrom) > new Date());

  return (
    <article className='public-product'>
      <Link className='public-product-image' to={`/products/${product.id}`} aria-label={`View ${product.name}`}>
        <img src={getProductImage(product)} alt='' loading='lazy' />
        <span className={`product-status ${isComingSoon ? 'coming_soon' : String(product.status).toLowerCase()}`}>
          {isComingSoon ? 'COMING SOON' : String(product.status).replaceAll('_', ' ')}
        </span>
      </Link>
      <div className='public-product-body'>
        <p className='eyebrow'>MEMBER PRODUCT</p>
        <h2><Link to={`/products/${product.id}`}>{product.name}</Link></h2>
        <p>{product.description || 'Daily income product package with guaranteed daily accrual.'}</p>
        <dl>
          <div><dt>Price</dt><dd>{money(product.price)}</dd></div>
          <div><dt>Daily Income ({Math.round(normalizedRate * 100)}%)</dt><dd className='highlight-green'>{money(dailyIncome)} / day</dd></div>
          <div><dt>Duration</dt><dd>{product.durationDays} days</dd></div>
          <div><dt>Total Revenue</dt><dd>{money(dailyIncome * product.durationDays)}</dd></div>
        </dl>
        {isComingSoon && product.availableFrom && (
          <div className='scheduled-badge'>
            Available: {new Date(product.availableFrom).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {user ? (
          <button className='public-primary' type='button' disabled={busy || isComingSoon || product.status !== 'AVAILABLE'} onClick={() => onPurchase(product.id)}>
            {busy ? 'Please wait…' : isComingSoon ? 'Coming Soon' : 'Purchase'} <ArrowRight size={16} />
          </button>
        ) : (
          <Link className='public-primary' to='/login'>Sign in to purchase <ArrowRight size={16} /></Link>
        )}
      </div>
    </article>
  );
}

function ProductPage({ product, loading, error, user, onPurchase, busy }) {
  if (loading) return <p className='public-state' role='status'>Loading product…</p>;
  if (error) return <p className='public-state public-error' role='alert'>{error}</p>;
  if (!product) return <p className='public-state'>This product is not available.</p>;

  const price = Number(product.price ?? 0);
  const normalizedRate = rateFraction(product.dailyRate ?? 0.24);
  const dailyIncome = price * normalizedRate;
  const isComingSoon = product.status === 'COMING_SOON' || (product.availableFrom && new Date(product.availableFrom) > new Date());

  return (
    <article className='public-product-detail'>
      <div className='public-detail-image'><img src={getProductImage(product)} alt={product.name} /></div>
      <div className='public-detail-copy'>
        <p className='eyebrow'>PRODUCT DETAILS</p>
        <p className={`product-status ${isComingSoon ? 'coming_soon' : String(product.status).toLowerCase()}`}>
          {isComingSoon ? 'COMING SOON' : String(product.status).replaceAll('_', ' ')}
        </p>
        <h1>{product.name}</h1>
        <p>{product.description || 'Contact support for more information about this product package.'}</p>
        <dl>
          <div><dt>Package Price</dt><dd>{money(product.price)}</dd></div>
          <div><dt>Daily Income ({Math.round(normalizedRate * 100)}%)</dt><dd className='highlight-green'>{money(dailyIncome)} / day</dd></div>
          <div><dt>Duration</dt><dd>{product.durationDays} days</dd></div>
          <div><dt>Total Revenue</dt><dd>{money(dailyIncome * product.durationDays)}</dd></div>
        </dl>
        {isComingSoon && product.availableFrom && (
          <div className='scheduled-badge'>
            Available: {new Date(product.availableFrom).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {user ? (
          <button className='public-primary' type='button' disabled={busy || isComingSoon || product.status !== 'AVAILABLE'} onClick={() => onPurchase(product.id)}>
            {busy ? 'Please wait…' : isComingSoon ? 'Coming Soon' : 'Purchase'} <ArrowRight size={16} />
          </button>
        ) : (
          <Link className='public-primary' to='/login'>Sign in to purchase <ArrowRight size={16} /></Link>
        )}
        <Link className='public-back-link' to='/products'>Back to products</Link>
      </div>
    </article>
  );
}

function SupportPage({ config }) {
  return <section className='public-copy-page'><p className='eyebrow'>CONTACT</p><h1>Support from the MKM team.</h1><p>{config?.supportMessage || 'Contact our support team for help with your account.'}</p><div className='public-support-links'>{config?.supportEnabled !== false && <><div><small>SUPPORT</small><strong>{config?.supportName || 'Customer Support'}</strong>{config?.supportPhone && <a href={`tel:${config.supportPhone}`}>{config.supportPhone}</a>}</div>{config?.whatsappUrl && <a className='public-primary' href={config.whatsappUrl} target='_blank' rel='noreferrer'>Message on WhatsApp <ArrowRight size={16} /></a>}</>}{config?.officialGroupEnabled && config?.officialGroupUrl && <div><small>COMMUNITY</small><strong>{config.officialGroupName || 'Official Group'}</strong><a href={config.officialGroupUrl} target='_blank' rel='noreferrer'>Visit group</a></div>}{!config && <p className='public-state'>Support details are currently unavailable.</p>}</div></section>;
}

function DownloadPage({ url }) {
  return <article className='public-copy-page'><p className='eyebrow'>MKM MOBILE</p><h1>Download the MKM app.</h1><p>Use the official app link provided by MKM to access your member account on your device.</p>{url ? <a className='public-primary' href={url} target='_blank' rel='noreferrer'><ArrowDownToLine size={16} /> Download App</a> : <p className='public-state'>The app download link has not been configured yet.</p>}</article>;
}

function RecoveryPage({ config }) {
  return <article className='public-copy-page'><p className='eyebrow'>ACCOUNT ACCESS</p><h1>Recover your account.</h1><p>Automated password reset is not configured. For account recovery, contact MKM support using the official contact details below. Never share your password or withdrawal password.</p><div className='public-support-links'>{config?.supportPhone && <div><small>SUPPORT PHONE</small><a href={`tel:${config.supportPhone}`}>{config.supportPhone}</a></div>}{config?.whatsappUrl && <a className='public-primary' href={config.whatsappUrl} target='_blank' rel='noreferrer'>Contact support on WhatsApp <ArrowRight size={16} /></a>}{!config?.supportPhone && !config?.whatsappUrl && <p className='public-state'>Contact information is currently unavailable.</p>}</div></article>;
}

function TermsPage() {
  return <article className='public-copy-page legal-page'><p className='eyebrow'>MKM POLICIES</p><h1>Terms of service</h1><p className='legal-notice'>This page summarizes the current service flow. The business owner should review and approve the final legal terms before launch.</p><section><h2>Using an account</h2><p>Use accurate account information and keep your login and withdrawal credentials private. You are responsible for activity performed through your authenticated account.</p></section><section><h2>Payments and wallet records</h2><p>Recharge requests are reviewed before funds are credited. Withdrawal requests are subject to account verification, configured limits and administrative processing. The status shown in your account reflects the service records.</p></section><section><h2>Products and rewards</h2><p>Product availability, price, duration and configured rates are shown in the catalog. Review those details before confirming a purchase. Referral rewards are calculated from approved activity according to the rates configured by MKM.</p></section><section><h2>Support</h2><p>For questions about your account or a transaction, contact MKM through the official support channels.</p></section></article>;
}

function PrivacyPage() {
  return <article className='public-copy-page legal-page'><p className='eyebrow'>MKM POLICIES</p><h1>Privacy notice</h1><p className='legal-notice'>This notice describes information used by the current MKM service. The business owner should confirm retention, legal basis and contact details before launch.</p><section><h2>Information used</h2><p>The service stores account name and phone number, password hashes, wallet and transaction records, referral relationships, withdrawal account details and payment proof submitted with recharge requests.</p></section><section><h2>Why it is used</h2><p>This information supports account access, payment review, wallet and withdrawal processing, referral calculations, customer support, fraud prevention and required service records.</p></section><section><h2>Security</h2><p>Credentials are handled by the service and should never be shared with support. Do not send passwords or one-time codes to anyone claiming to represent MKM.</p></section><section><h2>Questions</h2><p>Use the official <Link to='/support'>MKM support channels</Link> for questions about your information.</p></section></article>;
}
