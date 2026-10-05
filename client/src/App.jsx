import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Bell, CheckCircle2, CircleAlert, Copy, FileText, Gift, LayoutDashboard, LogOut, Menu, MessageCircle, Package, ShieldCheck, UserCircle, Users, Wallet, X, ZoomIn, ZoomOut } from 'lucide-react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, assetUrl, jsonBody } from './services/api.js';
import PublicWebsite from './PublicWebsite.jsx';
import welcomePromotionImage from './welcome-promotion.svg';
import { getProductImage } from './productImages.js';

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/tasks', label: 'Daily Tasks', icon: FileText },
  { to: '/purchases', label: 'Purchase History', icon: Package },
  { to: '/recharge', label: 'Recharge', icon: ArrowDownToLine },
  { to: '/recharge/history', label: 'Recharge History', icon: FileText },
  { to: '/withdrawal-account', label: 'Withdrawal Account', icon: ShieldCheck },
  { to: '/withdraw', label: 'Withdraw', icon: ArrowUpFromLine },
  { to: '/withdraw/history', label: 'Withdrawal History', icon: FileText },
  { to: '/referrals', label: 'Referrals', icon: Users },
  { to: '/rewards', label: 'Rewards', icon: Gift },
  { to: '/transactions', label: 'Transactions', icon: Wallet },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: UserCircle },
  { to: '/support', label: 'Support', icon: ShieldCheck },
];

const money = (amount) => `${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
const rateFraction = (rate) => {
  const value = Number(rate ?? 0);
  return value > 1 ? value / 100 : value;
};

function SuccessToast({ message, onDismiss }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismissRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className='success-toast' role='status' aria-live='polite'>
      <CheckCircle2 size={22} aria-hidden='true' />
      <span>{message}</span>
      <button type='button' onClick={onDismiss} aria-label='Dismiss success message'><X size={18} /></button>
    </div>
  );
}

function ErrorToast({ message, onDismiss }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      dismissRef.current?.();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message || !visible) return null;
  return (
    <div className='error-toast' role='alert' aria-live='assertive'>
      <CircleAlert size={22} aria-hidden='true' />
      <span>{message}</span>
      {onDismiss && <button type='button' onClick={onDismiss} aria-label='Dismiss error message'><X size={18} /></button>}
    </div>
  );
}

async function uploadAdminImage(file) {
  const form = new FormData();
  form.append('image', file);
  return api('/admin/uploads/image', { method: 'POST', body: form });
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [support, setSupport] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [customerSuccessAlert, setCustomerSuccessAlert] = useState('');
  const [error, setError] = useState('');
  const [auth, setAuth] = useState({
    fullName: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
    withdrawalPassword: '',
    confirmWithdrawalPassword: '',
    referralCode: '',
    acceptedTerms: false,
  });
  const [products, setProducts] = useState([]);
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [referralInfo, setReferralInfo] = useState(null);
  const [referralsLoading, setReferralsLoading] = useState(false);
  const [referralsError, setReferralsError] = useState('');
  const [methods, setMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [recharges, setRecharges] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [settings, setSettings] = useState({ minimumRechargeAmount: 300, maximumRechargeAmount: 1000000, withdrawalFee: 10 });
  const idempotencyKeys = useRef(new Map());
  const customerAlertTimer = useRef(null);

  function showCustomerSuccess(message) {
    if (customerAlertTimer.current) window.clearTimeout(customerAlertTimer.current);
    setCustomerSuccessAlert(message);
    customerAlertTimer.current = window.setTimeout(() => {
      setCustomerSuccessAlert('');
      customerAlertTimer.current = null;
    }, 5000);
  }

  function dismissCustomerSuccess() {
    if (customerAlertTimer.current) window.clearTimeout(customerAlertTimer.current);
    customerAlertTimer.current = null;
    setCustomerSuccessAlert('');
  }

  useEffect(() => () => {
    if (customerAlertTimer.current) window.clearTimeout(customerAlertTimer.current);
  }, []);

  useEffect(() => {
    if (location.pathname !== '/register') return;
    const referralCode = new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();
    if (referralCode) {
      setAuth((current) => ({ ...current, referralCode }));
    }
  }, [location.pathname, location.search]);

  async function loadDashboard() {
    const data = await api('/dashboard');
    setDashboard(data);
  }

  function idempotencyKeyFor(operation) {
    if (!idempotencyKeys.current.has(operation)) {
      idempotencyKeys.current.set(operation, crypto.randomUUID());
    }
    return idempotencyKeys.current.get(operation);
  }

  function resolveIdempotencyKey(operation, err) {
    if (!err || (err.status && err.status < 500)) {
      idempotencyKeys.current.delete(operation);
    }
  }

  function validateAuthInput(mode, payload) {
    const phonePattern = /^[97][0-9]{8}$/;
    if (!payload.phoneNumber || !phonePattern.test(payload.phoneNumber)) {
      throw new Error('Enter a valid 9-digit Ethiopian phone number starting with 9 or 7 (e.g. 912345678).');
    }
    if (payload.password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }
    if (mode === 'register') {
      if (!payload.fullName || payload.fullName.trim().length < 2) {
        throw new Error('Please enter your full name.');
      }
      if (payload.password !== payload.confirmPassword) {
        throw new Error('Login passwords do not match.');
      }
      if (!payload.acceptedTerms) {
        throw new Error('Please accept the account terms.');
      }
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const mode = location.pathname === '/register' ? 'register' : 'login';
      const payload = mode === 'login'
        ? { phoneNumber: auth.phoneNumber, password: auth.password }
        : { ...auth, referralCode: auth.referralCode || undefined };
      validateAuthInput(mode, payload);
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const result = await api(path, { method: 'POST', ...jsonBody(payload) });
      setUser(result);
      if (result.role === 'CUSTOMER') {
        showCustomerSuccess(mode === 'register' ? 'Your account was created successfully.' : 'You signed in successfully.');
      }
      navigate(result.role === 'ADMIN' ? '/admin/dashboard' : '/welcome', { replace: true });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (cause) {
      setError(cause.message);
      return;
    }
    setUser(null);
    setDashboard(null);
    setProducts([]);
    setMembers([]);
    setTeam(null);
    setReferralInfo(null);
    setReferralsLoading(false);
    setReferralsError('');
    setMethods([]);
    setAccounts([]);
    setRecharges([]);
    setWithdrawals([]);
    setNotice('');
    dismissCustomerSuccess();
    setError('');
    navigate('/login', { replace: true });
  }

  async function submitAdminAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        phoneNumber: auth.phoneNumber,
        password: auth.password,
      };
      validateAuthInput('login', payload);
      const result = await api('/auth/login', { method: 'POST', ...jsonBody(payload) });
      if (result.role !== 'ADMIN') {
        throw new Error('Administrator access is required.');
      }
      setUser(result);
      navigate('/admin/dashboard', { replace: true });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function purchase(productId) {
    setBusy(true);
    setError('');
    try {
      await api(`/products/${productId}/purchase`, {
        method: 'POST',
        idempotencyKey: idempotencyKeyFor(`product.purchase.${productId}`),
        ...jsonBody({}),
      });
      resolveIdempotencyKey(`product.purchase.${productId}`);
      await loadDashboard();
      setProducts(await api('/products'));
      showCustomerSuccess('Product purchased successfully.');
    } catch (cause) {
      resolveIdempotencyKey(`product.purchase.${productId}`, cause);
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRecharge(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const form = new FormData(formElement);
      await api('/recharges', {
        method: 'POST',
        body: form,
        idempotencyKey: idempotencyKeyFor('recharge.submit'),
      });
      resolveIdempotencyKey('recharge.submit');
      formElement.reset();
      setRecharges(await api('/recharges'));
      showCustomerSuccess('Recharge submitted successfully and is pending review.');
      navigate('/recharge/history');
    } catch (cause) {
      resolveIdempotencyKey('recharge.submit', cause);
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const form = new FormData(formElement);
      await api('/withdrawals', {
        method: 'POST',
        idempotencyKey: idempotencyKeyFor('withdrawal.submit'),
        ...jsonBody(Object.fromEntries(form)),
      });
      resolveIdempotencyKey('withdrawal.submit');
      formElement.reset();
      setWithdrawals(await api('/withdrawals'));
      await loadDashboard();
      setNotice('Withdrawal request submitted.');
      navigate('/withdraw/history');
    } catch (cause) {
      resolveIdempotencyKey('withdrawal.submit', cause);
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadDashboard().catch((cause) => setError(cause.message));
    api('/support').then(setSupport).catch(() => setSupport(null));
    if (user.role === 'ADMIN') {
      api('/admin/settings').then(setSettings).catch((cause) => setError(cause.message));
    }
  }, [user]);

  useEffect(() => {
    if (!user || !location.pathname.startsWith('/products')) return;
    let active = true;
    const loadProducts = () => {
      if (document.visibilityState === 'hidden') return;
      api('/products', { cache: 'no-store' })
        .then((items) => { if (active) setProducts(items); })
        .catch((cause) => { if (active) setError(cause.message); });
    };
    loadProducts();
    const refreshInterval = window.setInterval(loadProducts, 30000);
    window.addEventListener('focus', loadProducts);
    document.addEventListener('visibilitychange', loadProducts);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', loadProducts);
      document.removeEventListener('visibilitychange', loadProducts);
    };
  }, [user, location.pathname]);

  useEffect(() => {
    if (!user || location.pathname !== '/referrals') return;
    let active = true;
    setReferralsLoading(true);
    setReferralsError('');
    Promise.allSettled([
      api('/referrals'),
      api('/referrals/team/summary'),
      api('/referrals/team/members?limit=50'),
    ]).then(([referralResult, summaryResult, membersResult]) => {
      if (!active) return;
      const failures = [];
      if (referralResult.status === 'fulfilled') {
        setReferralInfo(referralResult.value);
      } else {
        failures.push(`Referral details: ${referralResult.reason?.message ?? 'Request failed.'}`);
      }
      if (summaryResult.status === 'fulfilled') {
        setTeam(summaryResult.value);
      } else {
        failures.push(`Referral summary: ${summaryResult.reason?.message ?? 'Request failed.'}`);
      }
      if (membersResult.status === 'fulfilled') {
        setMembers(membersResult.value.members ?? []);
      } else {
        failures.push(`Referral history: ${membersResult.reason?.message ?? 'Request failed.'}`);
      }
      setReferralsError(failures.join(' '));
    }).finally(() => {
      if (active) setReferralsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user, location.pathname]);

  useEffect(() => {
    if (!user || location.pathname !== '/recharge') return;
    Promise.all([
      api('/payment-methods'),
      api('/recharges'),
    ]).then(([paymentMethods, history]) => {
      setMethods(paymentMethods);
      setRecharges(history);
    }).catch((cause) => setError(cause.message));
  }, [user, location.pathname]);

  useEffect(() => {
    if (!user || !['/withdraw', '/withdrawal-account'].includes(location.pathname)) return;
    Promise.all([
      api('/withdrawal-accounts'),
      api('/withdrawals'),
      api('/payment-methods'),
      api('/withdrawals/config'),
    ]).then(([savedAccounts, history, paymentMethods, withdrawalConfig]) => {
      setAccounts(savedAccounts);
      setWithdrawals(history);
      setMethods(paymentMethods);
      setSettings((current) => ({ ...current, withdrawalFee: withdrawalConfig.withdrawalFee }));
    }).catch((cause) => setError(cause.message));
  }, [user, location.pathname]);

  useEffect(() => {
    if (user && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate(user.role === 'ADMIN' ? '/admin/dashboard' : '/welcome', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    if (authLoading) return;
    const publicPaths = ['/', '/about', '/products', '/support', '/download', '/forgot-password', '/terms', '/privacy'];
    const isPublicPath = publicPaths.includes(location.pathname) || location.pathname.startsWith('/products/');
    if (location.pathname.startsWith('/admin')) return;
    if (!user && !isPublicPath && location.pathname !== '/login' && location.pathname !== '/register' && location.pathname !== '/admin/login') {
      navigate('/login', { replace: true });
    }
  }, [authLoading, user, location.pathname, navigate]);

  if (authLoading) {
    return (
      <div className='auth-loading-splash'>
        <div className='auth-loading-inner'>
          <span className='brand-mark'>M</span>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path='/' element={user ? <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'} replace /> : <PublicWebsite user={null} onPurchase={purchase} busy={busy} />} />
      <Route path='/login' element={<AuthScreen auth={auth} setAuth={setAuth} mode='login' onSubmit={submitAuth} onSwitchMode={() => navigate(`/register${location.search}`)} busy={busy} error={error} onDismissError={() => setError('')} />} />
      <Route path='/register' element={<AuthScreen auth={auth} setAuth={setAuth} mode='register' onSubmit={submitAuth} onSwitchMode={() => navigate('/login')} busy={busy} error={error} onDismissError={() => setError('')} />} />
      <Route path='/admin/login' element={user ? <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'} replace /> : <AdminLoginScreen auth={auth} setAuth={setAuth} onSubmit={submitAdminAuth} busy={busy} error={error} onDismissError={() => setError('')} />} />
      <Route path='/admin/*' element={user?.role === 'ADMIN' ? <ProtectedAdminApp user={user} onSignOut={signOut} busy={busy} notice={notice} error={error} setError={setError} setNotice={setNotice} /> : <Navigate to={user ? '/dashboard' : '/admin/login'} replace />} />
      <Route path='/*' element={user ? <ProtectedCustomerApp user={user} dashboard={dashboard} support={support} products={products} team={team} members={members} referralInfo={referralInfo} referralsLoading={referralsLoading} referralsError={referralsError} setReferralsError={setReferralsError} methods={methods} accounts={accounts} recharges={recharges} withdrawals={withdrawals} settings={settings} busy={busy} notice={notice} customerSuccessAlert={customerSuccessAlert} onDismissCustomerAlert={dismissCustomerSuccess} error={error} setError={setError} setNotice={setNotice} onCopyReferral={() => {
        const code = dashboard?.referralCode ?? '';
        const referralLink = code ? `${window.location.origin}/register?ref=${encodeURIComponent(code)}` : '';
        navigator.clipboard?.writeText(referralLink).catch(() => undefined);
        setNotice(referralLink ? 'Referral link copied.' : 'No referral link available.');
      }} onPurchase={purchase} onSubmitRecharge={submitRecharge} onSubmitWithdrawal={submitWithdrawal} onCustomerSuccess={showCustomerSuccess} onRefreshDashboard={loadDashboard} onSaveAccount={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        setBusy(true);
        setError('');
        try {
          const data = Object.fromEntries(new FormData(formElement));
          const selectedMethod = methods.find((method) => method.id === data.paymentMethodId);
          const accountNumber = String(data.accountNumber ?? '').trim();
          const providerName = selectedMethod?.name ?? 'Other';
          const rules = {
            'Awash Bank': /^[0-9]{14,15}$/,
            'CBE': /^[0-9]{13}$/,
            'Telebirr': /^[0-9]{10}$/,
            'Abyssinia Bank': /^[0-9]{6,9}$/,
          };
          if (selectedMethod && !rules[providerName]?.test(accountNumber)) {
            throw new Error(`Account number format is invalid for ${providerName}.`);
          }
          if (data.newWithdrawalPassword) {
            if (data.newWithdrawalPassword !== data.confirmNewWithdrawalPassword) throw new Error('Withdrawal passwords do not match.');
            await api('/profile/withdrawal-password', {
              method: 'PATCH',
              ...jsonBody({ newWithdrawalPassword: data.newWithdrawalPassword, confirmNewWithdrawalPassword: data.confirmNewWithdrawalPassword }),
            });
          }
          const { newWithdrawalPassword, confirmNewWithdrawalPassword, ...accountData } = data;
          await api('/withdrawal-accounts', {
            method: 'POST',
            ...jsonBody({
              ...accountData,
              paymentMethodId: data.paymentMethodId || null,
            }),
          });
          setAccounts(await api('/withdrawal-accounts'));
          formElement.reset();
          setNotice('Withdrawal account saved.');
        } catch (cause) {
          setError(cause.message);
        } finally {
          setBusy(false);
        }
      }} onSignOut={signOut} /> : <PublicWebsite user={null} onPurchase={purchase} busy={busy} />} />
    </Routes>
  );
}

function ProtectedAdminApp({ user, onSignOut, busy, notice, error, setError, setNotice }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [customers, setCustomers] = useState({ items: [] });
  const [products, setProducts] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [support, setSupport] = useState({});

  async function saveSupport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const normalized = {
      ...payload,
      supportEnabled: payload.supportEnabled === 'on',
      customerSupportEnabled: payload.customerSupportEnabled === 'on',
      whatsappEnabled: payload.whatsappEnabled === 'on',
      officialGroupEnabled: payload.officialGroupEnabled === 'on',
    };
    try {
      await api('/admin/support', { method: 'PUT', ...jsonBody(normalized) });
      const refreshed = await api('/admin/support');
      setSupport(refreshed);
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function saveAboutPage(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      await api('/admin/support/about', { method: 'PUT', ...jsonBody(payload) });
      setSupport(await api('/admin/support'));
      setNotice('Public About page saved successfully.');
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function saveWelcomePage(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      payload.welcomeExamplePrice = Number(payload.welcomeExamplePrice);
      payload.welcomeExampleDailyEarnings = Number(payload.welcomeExampleDailyEarnings);
      await api('/admin/support/welcome', { method: 'PUT', ...jsonBody(payload) });
      setSupport(await api('/admin/support'));
      setNotice('Welcome page updated successfully.');
    } catch (cause) {
      setError(cause.message);
    }
  }

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') {
      navigate('/admin/login', { replace: true });
      return;
    }
    const load = async () => {
      try {
        const [dashboard, customerList, productList, paymentList, supportData] = await Promise.all([
          api('/admin/dashboard'),
          api('/admin/customers?limit=25&page=1'),
          api('/admin/products'),
          api('/admin/payment-methods'),
          api('/admin/support'),
        ]);
        setStats(dashboard);
        setCustomers(customerList);
        setProducts(productList);
        setPaymentMethods(paymentList);
        setSupport(supportData);
      } catch (cause) {
        setError(cause.message);
      }
    };
    load();
  }, [user, navigate, setError]);

  useEffect(() => {
    setNavOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const currentPath = location.pathname || '/admin/dashboard';
  const adminNavItems = [
    { to: '/admin/dashboard', label: 'Dashboard' },
    { to: '/admin/customers', label: 'Customers' },
    { to: '/admin/admins', label: 'Admin Management' },
    { to: '/admin/profile', label: 'My Profile' },
    { to: '/admin/recharges', label: 'Recharges' },
    { to: '/admin/withdrawals', label: 'Withdrawals' },
    { to: '/admin/rewards', label: 'Rewards' },
    { to: '/admin/referrals', label: 'Referrals' },
    { to: '/admin/audit-logs', label: 'Audit Logs' },
    { to: '/admin/products', label: 'Products' },
    { to: '/admin/payment-methods', label: 'Payment Methods' },
    { to: '/admin/support', label: 'Support' },
    { to: '/admin/about', label: 'About Page' },
    { to: '/admin/welcome', label: 'Welcome Page' },
    { to: '/admin/settings/links', label: 'Public Links' },
    { to: '/admin/password', label: 'Change Password' },
  ];
  const currentTitle = adminNavItems.find(({ to }) => to === currentPath)?.label ?? 'Management dashboard';
  const renderAdminPage = () => {
    if (currentPath === '/admin/dashboard') {
      return <AdminDashboardPage stats={stats} />;
    }
    if (currentPath === '/admin/customers') {
      return <AdminCustomersPage customers={customers} paymentMethods={paymentMethods} onError={setError} />;
    }
    if (currentPath === '/admin/admins') {
      return <AdminManagementPage user={user} onError={setError} onNotice={setNotice} />;
    }
    if (currentPath === '/admin/profile') {
      return <AdminProfilePage user={user} onError={setError} onNotice={setNotice} />;
    }
    if (currentPath === '/admin/password') {
      return <AdminPasswordPage onError={setError} onNotice={setNotice} />;
    }
    if (currentPath === '/admin/products') {
      return <AdminProductsPage products={products} onUploadImage={uploadAdminImage} />;
    }
    if (currentPath === '/admin/recharges') {
      return <AdminRechargesPage />;
    }
    if (currentPath === '/admin/withdrawals') {
      return <AdminWithdrawalsPage />;
    }
    if (currentPath === '/admin/rewards') {
      return <AdminRewardsPage onError={setError} onNotice={setNotice} />;
    }
    if (currentPath === '/admin/referrals') {
      return <AdminReferralsPage onError={setError} />;
    }
    if (currentPath === '/admin/audit-logs') {
      return <AdminAuditLogsPage />;
    }
    if (currentPath === '/admin/payment-methods') {
      return <AdminPaymentMethodsPage methods={paymentMethods} />;
    }
    if (currentPath === '/admin/support') {
      return <AdminSupportPage support={support} onSave={saveSupport} />;
    }
    if (currentPath === '/admin/about') {
      return <AdminAboutPage support={support} onSave={saveAboutPage} />;
    }
    if (currentPath === '/admin/welcome') {
      return <AdminWelcomePage support={support} onSave={saveWelcomePage} onUploadImage={uploadAdminImage} onError={setError} />;
    }
    if (currentPath === '/admin/settings/links') {
      return <AdminPublicLinksPage />;
    }
    return <Navigate to='/admin/dashboard' replace />;
  };

  return (
    <div className='workspace admin-workspace'>
      <aside className='sidebar'>
        <div className='sidebar-heading'>
          <NavLink to='/admin/dashboard' className='brand' end>
            <span className='brand-mark'>A</span>
            <span>MKM Admin<span className='brand-caption'>ADMIN PANEL</span></span>
          </NavLink>
          <button className='workspace-menu-toggle' type='button' aria-expanded={navOpen} aria-controls='admin-navigation' aria-label={navOpen ? 'Close admin navigation' : 'Open admin navigation'} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <p className='nav-label'>ADMIN</p>
        <nav id='admin-navigation' className={navOpen ? 'is-open' : ''} aria-label='Admin navigation'>
          {adminNavItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end={to === '/admin/dashboard'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className='sidebar-bottom'>
          <span className='avatar'>{user?.fullName?.slice(0, 1).toUpperCase()}</span>
          <div className='user-chip'><strong>{user?.fullName}</strong><small>ADMIN</small></div>
          <button className='sign-out-button' type='button' onClick={onSignOut}><LogOut size={16} /> Log out</button>
        </div>
      </aside>
      <main className='main-area'>
        <header className='topbar'>
          <div>
            <p className='eyebrow'>ADMIN AREA</p>
            <h1>{currentTitle}</h1>
          </div>
        </header>
        <div className='content'>
          {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
          {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}
          {renderAdminPage()}
        </div>
      </main>
      <nav className='customer-mobile-footer admin-mobile-footer' aria-label='Mobile admin navigation'>
        {mobileMenuOpen && (
          <div className='customer-mobile-menu'>
            <div className='customer-mobile-menu-heading'>
              <strong>All admin pages</strong>
              <button type='button' className='customer-mobile-menu-close' onClick={() => setMobileMenuOpen(false)} aria-label='Close all pages menu'><X size={18} /></button>
            </div>
            <div className='customer-mobile-menu-grid'>
              {adminNavItems.map(({ to, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `customer-mobile-menu-link ${isActive ? 'active' : ''}`} end={to === '/admin/dashboard'}>
                  <span>{label}</span>
                </NavLink>
              ))}
              <button type='button' className='customer-mobile-menu-link admin-mobile-logout' onClick={onSignOut}><LogOut size={18} /><span>Log out</span></button>
            </div>
          </div>
        )}
        <div className='customer-mobile-dock'>
          {adminNavItems.filter(({ to }) => ['/admin/dashboard', '/admin/customers', '/admin/recharges', '/admin/withdrawals'].includes(to)).map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `customer-mobile-dock-link ${isActive ? 'active' : ''}`} end={to === '/admin/dashboard'}>
              <span>{({ Dashboard: 'Home', Customers: 'Users', Recharges: 'Recharge', Withdrawals: 'Payouts' })[label] ?? label}</span>
            </NavLink>
          ))}
          <button type='button' className={`customer-mobile-dock-link ${mobileMenuOpen ? 'active' : ''}`} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
            {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
            <span>{mobileMenuOpen ? 'Close' : 'More'}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function AdminDashboardPage({ stats }) {
  const data = stats ?? {};
  return (
    <>
      <div className='metric-grid'>
        <Metric label='Total customers' value={data.total_customers ?? 0} />
        <Metric label='Customers with purchases' value={data.active_customers ?? 0} />
        <Metric label='Pending recharges' value={data.pending_recharges ?? 0} />
        <Metric label='Approved recharge total' value={money(data.approved_recharge_total ?? 0)} />
        <Metric label='Pending withdrawals' value={data.pending_withdrawals ?? 0} />
        <Metric label='Completed withdrawal total' value={money(data.completed_withdrawal_total ?? 0)} />
        <Metric label='Total products' value={data.total_products ?? 0} />
        <Metric label='Active products' value={data.active_products ?? 0} />
      </div>
    </>
  );
}

function AdminCustomersPage({ customers: initialCustomers, paymentMethods, onError }) {
  const [customers, setCustomers] = useState(initialCustomers?.items ?? []);
  const [pagination, setPagination] = useState(initialCustomers?.pagination ?? { page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetCustomerId, setResetCustomerId] = useState(null);
  const [editProfileId, setEditProfileId] = useState(null);
  const [editAccountId, setEditAccountId] = useState(null);
  const [pendingCustomerId, setPendingCustomerId] = useState(null);
  const [notice, setNotice] = useState('');

  // Details modal state
  const [viewCustomerDetails, setViewCustomerDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Deactivate modal state
  const [deactivatingCustomer, setDeactivatingCustomer] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivateAdminPassword, setDeactivateAdminPassword] = useState('');

  useEffect(() => {
    setCustomers(initialCustomers?.items ?? []);
    setPagination(initialCustomers?.pagination ?? { page: 1, pages: 1, total: 0 });
  }, [initialCustomers]);

  async function loadCustomers(nextPage = 1, nextQuery = query, nextStatus = statusFilter) {
    setLoading(true);
    onError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: '25' });
      if (nextQuery.trim()) params.set('search', nextQuery.trim());
      if (nextStatus) params.set('status', nextStatus);
      const result = await api(`/admin/customers?${params}`);
      setCustomers(result.items ?? []);
      setPagination(result.pagination ?? { page: nextPage, pages: 1, total: 0 });
    } catch (cause) {
      onError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(customerId) {
    setDetailsLoading(true);
    onError('');
    try {
      const details = await api(`/admin/customers/${customerId}`);
      setViewCustomerDetails(details);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function saveCustomerProfile(event, customer) {
    event.preventDefault();
    const form = event.currentTarget;
    setPendingCustomerId(customer.id);
    setNotice('');
    onError('');
    try {
      await api(`/admin/customers/${customer.id}/profile`, {
        method: 'PUT',
        ...jsonBody(Object.fromEntries(new FormData(form))),
      });
      setNotice(`Updated ${customer.fullName}'s profile.`);
      setEditProfileId(null);
      await loadCustomers(pagination.page);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setPendingCustomerId(null);
    }
  }

  async function saveWithdrawalAccount(event, customer, account) {
    event.preventDefault();
    const form = event.currentTarget;
    setPendingCustomerId(customer.id);
    setNotice('');
    onError('');
    try {
      await api(`/admin/customers/${customer.id}/withdrawal-accounts/${account.id}`, {
        method: 'PUT',
        ...jsonBody(Object.fromEntries(new FormData(form))),
      });
      setNotice(`Updated ${account.paymentProvider} payout details for ${customer.fullName}.`);
      setEditAccountId(null);
      await loadCustomers(pagination.page);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setPendingCustomerId(null);
    }
  }

  async function resetPassword(event, customer) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setPendingCustomerId(customer.id);
    setNotice('');
    onError('');
    try {
      await api(`/admin/customers/${customer.id}/password-reset`, {
        method: 'POST',
        ...jsonBody(data),
      });
      setNotice(`Login password reset for ${customer.fullName}. Their active sessions were signed out.`);
      setResetCustomerId(null);
      form.reset();
    } catch (cause) {
      onError(cause.message);
    } finally {
      setPendingCustomerId(null);
    }
  }

  async function handleToggleStatus(customer, targetStatus, reason = '', adminPassword = '') {
    setPendingCustomerId(customer.id);
    setNotice('');
    onError('');
    try {
      const payload = { status: targetStatus };
      if (reason.trim()) payload.reason = reason.trim();
      if (adminPassword.trim()) payload.adminPassword = adminPassword.trim();
      const res = await api(`/admin/customers/${customer.id}/status`, {
        method: 'PATCH',
        ...jsonBody(payload),
      });
      setNotice(
        targetStatus === 'ACTIVE'
          ? `Customer ${customer.fullName} has been reactivated successfully.`
          : `Customer ${customer.fullName} has been deactivated. ${res.sessionsRevoked ?? 0} active session(s) were revoked. Financial history remains preserved.`
      );
      setDeactivatingCustomer(null);
      setDeactivateReason('');
      setDeactivateAdminPassword('');
      await loadCustomers(pagination.page);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setPendingCustomerId(null);
    }
  }

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>CUSTOMERS</p>
          <h3>Customer list & account management</h3>
        </div>
      </div>
      <form
        className='customer-search-row'
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
          loadCustomers(1, search, statusFilter);
        }}
      >
        <label className='field'>
          <span>Search customers</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Name, phone, or referral code'
          />
        </label>
        <label className='field' style={{ maxWidth: '180px' }}>
          <span>Status filter</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              const val = event.target.value;
              setStatusFilter(val);
              loadCustomers(1, search, val);
            }}
          >
            <option value=''>All Statuses</option>
            <option value='ACTIVE'>Active</option>
            <option value='SUSPENDED'>Suspended</option>
            <option value='DEACTIVATED'>Deactivated</option>
          </select>
        </label>
        <button className='primary-button' type='submit' disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button
          className='secondary-button'
          type='button'
          disabled={loading}
          onClick={() => {
            setSearch('');
            setQuery('');
            setStatusFilter('');
            loadCustomers(1, '', '');
          }}
        >
          Clear
        </button>
      </form>
      {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}

      {/* Customer Details Modal */}
      {viewCustomerDetails && (
        <div className='surface form-surface' style={{ margin: '16px 0', border: '2px solid var(--line)' }}>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>CUSTOMER DETAILS</p>
              <h3>{viewCustomerDetails.fullName} ({viewCustomerDetails.phoneNumber})</h3>
            </div>
            <button className='secondary-button' type='button' onClick={() => setViewCustomerDetails(null)}>✕ Close</button>
          </div>
          <div className='metric-grid' style={{ marginTop: '12px' }}>
            <div className='metric'><span>Status</span><StatusBadge status={viewCustomerDetails.status} /></div>
            <div className='metric'><span>Available Wallet</span><strong className='green'>{money(viewCustomerDetails.wallet?.availableBalance ?? 0)}</strong></div>
            <div className='metric'><span>Locked Wallet</span><strong>{money(viewCustomerDetails.wallet?.lockedBalance ?? 0)}</strong></div>
            <div className='metric'><span>Approved Deposits</span><strong className='green'>{money(viewCustomerDetails.recharges?.approvedTotal ?? 0)} ({viewCustomerDetails.recharges?.count ?? 0})</strong></div>
            <div className='metric'><span>Completed Payouts</span><strong>{money(viewCustomerDetails.withdrawals?.completedTotal ?? 0)} ({viewCustomerDetails.withdrawals?.count ?? 0})</strong></div>
            <div className='metric'><span>Active Packages</span><strong className='green'>{viewCustomerDetails.purchases?.activeCount ?? 0}</strong></div>
          </div>
          {viewCustomerDetails.recentTransactions?.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <p className='eyebrow'>RECENT TRANSACTIONS</p>
              <div className='table-wrap'>
                <table>
                  <thead>
                    <tr><th>Type</th><th>Amount</th><th>Direction</th><th>Status</th><th>Description</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {viewCustomerDetails.recentTransactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{tx.type}</td>
                        <td>{money(tx.amount)}</td>
                        <td><span style={{ color: tx.direction === 'CREDIT' ? '#16a34a' : '#dc2626' }}>{tx.direction}</span></td>
                        <td><StatusBadge status={tx.status} /></td>
                        <td>{tx.description}</td>
                        <td>{new Date(tx.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deactivation Confirmation Modal */}
      {deactivatingCustomer && (
        <div className='surface form-surface' style={{ margin: '16px 0', border: '2px solid #ef4444', background: '#fef2f2' }}>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow' style={{ color: '#b91c1c' }}>PROTECTED ACTION: DEACTIVATE CUSTOMER</p>
              <h3>Deactivate {deactivatingCustomer.fullName}?</h3>
            </div>
            <button className='secondary-button' type='button' onClick={() => setDeactivatingCustomer(null)}>Cancel</button>
          </div>
          <p style={{ fontSize: '13px', color: '#7f1d1d', margin: '8px 0' }}>
            Deactivating this customer will immediately revoke all their active login sessions. They will be prohibited from signing in or accessing account services.
            <strong> All financial records, wallets, purchase history, ledger entries, and audit logs remain strictly preserved.</strong>
          </p>
          <div className='form-stack' style={{ maxWidth: '420px', marginTop: '12px' }}>
            <label className='field'>
              <span>Reason for deactivation (optional)</span>
              <input
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                placeholder='e.g. Terms violation or suspicious activity'
                maxLength={500}
              />
            </label>
            <label className='field'>
              <span>Confirm admin password (optional)</span>
              <input
                type='password'
                value={deactivateAdminPassword}
                onChange={(e) => setDeactivateAdminPassword(e.target.value)}
                placeholder='Your admin password'
                autoComplete='current-password'
              />
            </label>
            <div className='button-row compact'>
              <button
                className='primary-button'
                type='button'
                style={{ background: '#dc2626', borderColor: '#b91c1c' }}
                disabled={pendingCustomerId === deactivatingCustomer.id}
                onClick={() => handleToggleStatus(deactivatingCustomer, 'DEACTIVATED', deactivateReason, deactivateAdminPassword)}
              >
                {pendingCustomerId === deactivatingCustomer.id ? 'Deactivating…' : 'Confirm Deactivate'}
              </button>
              <button className='secondary-button' type='button' onClick={() => setDeactivatingCustomer(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {customers.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Wallet Balance</th>
                <th>Referral</th>
                <th>Withdrawal accounts</th>
                <th>Registered</th>
                <th>Customer actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    {editProfileId === customer.id ? (
                      <form className='form-stack' onSubmit={(event) => saveCustomerProfile(event, customer)}>
                        <label className='field'><span>Full name</span><input name='fullName' defaultValue={customer.fullName} minLength='2' maxLength='120' required /></label>
                        <label className='field'><span>Phone (9 digits)</span><input name='phoneNumber' defaultValue={customer.phoneNumber} pattern='[97][0-9]{8}' maxLength='9' required /></label>
                        <label className='field'><span>Confirm admin password</span><input name='adminPassword' type='password' autoComplete='current-password' required /></label>
                        <div className='button-row compact'>
                          <button className='primary-button' type='submit' disabled={pendingCustomerId === customer.id}>{pendingCustomerId === customer.id ? 'Saving…' : 'Save profile'}</button>
                          <button className='secondary-button' type='button' onClick={() => setEditProfileId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <strong>{customer.fullName}</strong>
                        <button className='secondary-button' type='button' style={{ marginLeft: '6px', padding: '2px 8px', fontSize: '11px' }} onClick={() => setEditProfileId(customer.id)}>Edit</button>
                      </>
                    )}
                  </td>
                  <td>{customer.phoneNumber}</td>
                  <td><StatusBadge status={customer.status} /></td>
                  <td>
                    <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '12px', display: 'block' }}>
                      Avail: {money(customer.availableBalance ?? 0)}
                    </span>
                    <small style={{ color: '#6b7280', fontSize: '11px', display: 'block' }}>
                      Locked: {money(customer.lockedBalance ?? 0)}
                    </small>
                  </td>
                  <td>{customer.referralCode}</td>
                  <td>{customer.withdrawalAccounts?.length ? customer.withdrawalAccounts.map((account) => (
                    <section className='nested-surface form-stack' key={account.id} style={{ marginBottom: '4px' }}>
                      <strong>{account.paymentProvider}</strong>
                      {editAccountId === account.id ? (
                        <form className='form-stack' onSubmit={(event) => saveWithdrawalAccount(event, customer, account)}>
                          <label className='field'><span>Payment provider</span>
                            <select name='paymentMethodId' defaultValue={account.paymentMethodId} required>
                              {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                            </select>
                          </label>
                          <label className='field'><span>Account holder name</span><input name='accountHolderName' defaultValue={account.accountHolderName} minLength='2' maxLength='120' required /></label>
                          <label className='field'><span>Full account / phone number</span><input name='accountNumber' defaultValue={account.accountNumber} minLength='3' maxLength='120' required /></label>
                          <label className='field'><span>Linked phone number (optional)</span><input name='phoneNumber' defaultValue={account.phoneNumber ?? ''} maxLength='40' /></label>
                          <label className='field'><span>Confirm admin password</span><input name='adminPassword' type='password' autoComplete='current-password' required /></label>
                          <div className='button-row compact'>
                            <button className='primary-button' type='submit' disabled={pendingCustomerId === customer.id}>{pendingCustomerId === customer.id ? 'Saving…' : 'Save account'}</button>
                            <button className='secondary-button' type='button' onClick={() => setEditAccountId(null)}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <small>{account.accountHolderName} · {account.accountNumber || account.phoneNumber || '—'}</small>
                          <button className='secondary-button' type='button' style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setEditAccountId(account.id)}>Edit payout</button>
                        </>
                      )}
                    </section>
                  )) : '—'}</td>
                  <td>{new Date(customer.registeredAt).toLocaleDateString()}</td>
                  <td>
                    <div className='form-stack' style={{ gap: '6px' }}>
                      <button
                        className='secondary-button'
                        type='button'
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        disabled={detailsLoading}
                        onClick={() => loadDetails(customer.id)}
                      >
                        View details
                      </button>

                      {customer.role === 'CUSTOMER' && (
                        resetCustomerId === customer.id ? (
                          <form className='form-stack' onSubmit={(event) => resetPassword(event, customer)}>
                            <label className='field'><span>Admin password</span><input name='adminPassword' type='password' autoComplete='current-password' required /></label>
                            <label className='field'><span>New password</span><input name='newPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required /></label>
                            <label className='field'><span>Confirm password</span><input name='confirmNewPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required /></label>
                            <div className='button-row compact'>
                              <button className='primary-button' type='submit' disabled={pendingCustomerId === customer.id}>{pendingCustomerId === customer.id ? 'Resetting…' : 'Reset'}</button>
                              <button className='secondary-button' type='button' onClick={() => setResetCustomerId(null)}>Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <button className='secondary-button' type='button' style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => { setNotice(''); setResetCustomerId(customer.id); }}>
                            Reset password
                          </button>
                        )
                      )}

                      {customer.role === 'CUSTOMER' && (
                        customer.status === 'ACTIVE' ? (
                          <button
                            className='secondary-button'
                            type='button'
                            style={{ padding: '3px 8px', fontSize: '11px', color: '#dc2626', borderColor: '#fca5a5' }}
                            disabled={pendingCustomerId === customer.id}
                            onClick={() => {
                              setNotice('');
                              setDeactivatingCustomer(customer);
                            }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className='secondary-button'
                            type='button'
                            style={{ padding: '3px 8px', fontSize: '11px', color: '#16a34a', borderColor: '#86efac' }}
                            disabled={pendingCustomerId === customer.id}
                            onClick={() => handleToggleStatus(customer, 'ACTIVE')}
                          >
                            {pendingCustomerId === customer.id ? 'Reactivating…' : 'Reactivate'}
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loading ? <Empty>Loading customers…</Empty> : <Empty>No customers found.</Empty>}
      <div className='button-row customer-pagination'>
        <span className='quiet-label'>PAGE {pagination.page ?? 1} OF {pagination.pages ?? 1} · {pagination.total ?? customers.length} CUSTOMERS</span>
        <button className='secondary-button' type='button' disabled={loading || (pagination.page ?? 1) <= 1} onClick={() => loadCustomers((pagination.page ?? 1) - 1)}>Previous</button>
        <button className='secondary-button' type='button' disabled={loading || (pagination.page ?? 1) >= (pagination.pages ?? 1)} onClick={() => loadCustomers((pagination.page ?? 1) + 1)}>Next</button>
      </div>
    </section>
  );
}

function AdminProfilePage({ user, onError, onNotice }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function loadProfile() {
    setLoading(true);
    onError('');
    try {
      const data = await api('/admin/profile');
      setProfile(data);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setProfileBusy(true);
    onError('');
    onNotice('');
    try {
      const updated = await api('/admin/profile', {
        method: 'PATCH',
        ...jsonBody(data),
      });
      setProfile(updated);
      onNotice('Your administrator profile was updated successfully.');
    } catch (cause) {
      onError(cause.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setPasswordBusy(true);
    onError('');
    onNotice('');
    try {
      await api('/admin/profile/password', {
        method: 'PATCH',
        ...jsonBody(data),
      });
      form.reset();
      onNotice('Your admin password was changed. All other active sessions were signed out.');
    } catch (cause) {
      onError(cause.message);
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loading) {
    return <section className='surface form-surface'><Empty>Loading administrator profile…</Empty></section>;
  }

  const p = profile ?? user ?? {};

  return (
    <div className='form-stack' style={{ gap: '20px' }}>
      {/* Account Overview Card */}
      <section className='surface form-surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>ADMIN PROFILE</p>
            <h3>Account overview</h3>
          </div>
          <StatusBadge status={p.status ?? 'ACTIVE'} />
        </div>
        <div className='metric-grid' style={{ marginTop: '14px' }}>
          <div className='metric'>
            <span>Administrator</span>
            <strong>{p.fullName}</strong>
            <small>NAME</small>
          </div>
          <div className='metric'>
            <span>Phone number</span>
            <strong>{p.phoneNumber}</strong>
            <small>ETHIOPIAN PHONE</small>
          </div>
          <div className='metric'>
            <span>Access level</span>
            <strong className={p.isSuperAdmin ? 'green' : ''}>
              {p.isSuperAdmin ? 'SUPER ADMIN' : 'ADMINISTRATOR'}
            </strong>
            <small>ROLE</small>
          </div>
          <div className='metric'>
            <span>Member since</span>
            <strong>{p.registeredAt ? new Date(p.registeredAt).toLocaleDateString() : '—'}</strong>
            <small>REGISTERED</small>
          </div>
        </div>

        {/* Assigned Privileges */}
        <div style={{ marginTop: '16px' }}>
          <p className='eyebrow'>ASSIGNED PRIVILEGES</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {p.isSuperAdmin || p.privileges?.includes('*') ? (
              <span className='status-badge status-approved' style={{ padding: '6px 12px', fontSize: '12px' }}>
                ★ Full Unrestricted Privileges (Super Admin)
              </span>
            ) : p.privileges?.length ? (
              p.privileges.map((priv) => (
                <span key={priv} className='status-badge' style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px' }}>
                  {priv}
                </span>
              ))
            ) : (
              <span style={{ fontSize: '13px', opacity: 0.6 }}>No specific module privileges assigned.</span>
            )}
          </div>
        </div>
      </section>

      {/* Edit Profile Information Form */}
      <section className='surface form-surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>PERSONAL INFORMATION</p>
            <h3>Edit profile details</h3>
          </div>
        </div>
        <form className='form-stack' onSubmit={saveProfile} style={{ maxWidth: '480px', marginTop: '12px' }}>
          <label className='field'>
            <span>Full name</span>
            <input name='fullName' defaultValue={p.fullName ?? ''} minLength='2' maxLength='120' required />
          </label>
          <label className='field'>
            <span>Phone number (9 digits, starts with 9 or 7)</span>
            <input name='phoneNumber' defaultValue={p.phoneNumber ?? ''} pattern='[97][0-9]{8}' maxLength='9' required />
          </label>
          <button className='primary-button' type='submit' disabled={profileBusy}>
            {profileBusy ? 'Saving profile…' : 'Save profile changes'} <span>↗</span>
          </button>
        </form>
      </section>

      {/* Security & Password Change */}
      <section className='surface form-surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>SECURITY</p>
            <h3>Change administrator password</h3>
          </div>
        </div>
        <p className='form-subtitle'>
          Confirm your current password to set a new one. Changing your password immediately revokes all other active administrator sessions.
        </p>
        <form className='form-stack' onSubmit={changePassword} style={{ maxWidth: '480px', marginTop: '12px' }}>
          <label className='field'>
            <span>Current password</span>
            <input name='currentPassword' type='password' autoComplete='current-password' required />
          </label>
          <label className='field'>
            <span>New password (min 6 characters)</span>
            <input name='newPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required />
          </label>
          <label className='field'>
            <span>Confirm new password</span>
            <input name='confirmNewPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required />
          </label>
          <button className='primary-button' type='submit' disabled={passwordBusy}>
            {passwordBusy ? 'Updating password…' : 'Change password'} <span>↗</span>
          </button>
        </form>
      </section>
    </div>
  );
}

const ALL_PRIVILEGES_LIST = [
  { key: 'CUSTOMER_VIEW', label: 'View customers' },
  { key: 'CUSTOMER_MANAGE', label: 'Manage & deactivate customers' },
  { key: 'PRODUCT_VIEW', label: 'View products' },
  { key: 'PRODUCT_MANAGE', label: 'Create & edit products' },
  { key: 'RECHARGE_VIEW', label: 'View deposits & recharges' },
  { key: 'RECHARGE_APPROVE', label: 'Approve & reject recharges' },
  { key: 'WITHDRAWAL_VIEW', label: 'View withdrawal requests' },
  { key: 'WITHDRAWAL_APPROVE', label: 'Approve & process payouts' },
  { key: 'TRANSACTION_VIEW', label: 'View ledger & transactions' },
  { key: 'TASK_VIEW', label: 'View daily task progress' },
  { key: 'TASK_MANAGE', label: 'Manage daily tasks & rewards' },
  { key: 'REFERRAL_VIEW', label: 'View referral network' },
  { key: 'SETTINGS_VIEW', label: 'View platform settings' },
  { key: 'SETTINGS_MANAGE', label: 'Modify platform settings' },
  { key: 'ADMIN_VIEW', label: 'View administrator accounts' },
  { key: 'ADMIN_CREATE', label: 'Create new administrators' },
  { key: 'ADMIN_MANAGE', label: 'Manage administrator privileges' },
];

function AdminManagementPage({ user, onError, onNotice }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [busyAdminId, setBusyAdminId] = useState(null);
  const [addBusy, setAddBusy] = useState(false);

  // Form states for adding admin
  const [addIsSuperAdmin, setAddIsSuperAdmin] = useState(false);
  const [addPrivileges, setAddPrivileges] = useState([]);

  // Form states for editing privileges
  const [editIsSuperAdmin, setEditIsSuperAdmin] = useState(false);
  const [editPrivileges, setEditPrivileges] = useState([]);

  async function loadAdmins() {
    setLoading(true);
    onError('');
    try {
      const data = await api('/admin/admins');
      setAdmins(data);
    } catch (cause) {
      onError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmins();
  }, []);

  function toggleAddPrivilege(key) {
    setAddPrivileges((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  function toggleEditPrivilege(key) {
    setEditPrivileges((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  async function submitAddAdmin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    data.isSuperAdmin = addIsSuperAdmin;
    data.privileges = addIsSuperAdmin ? ['*'] : addPrivileges;

    setAddBusy(true);
    onError('');
    onNotice('');
    try {
      const created = await api('/admin/admins', {
        method: 'POST',
        ...jsonBody(data),
      });
      onNotice(`Administrator ${created.fullName} created successfully.`);
      setAddModalOpen(false);
      setAddIsSuperAdmin(false);
      setAddPrivileges([]);
      form.reset();
      await loadAdmins();
    } catch (cause) {
      onError(cause.message);
    } finally {
      setAddBusy(false);
    }
  }

  async function submitEditPrivileges(event) {
    event.preventDefault();
    if (!editingAdmin) return;
    setBusyAdminId(editingAdmin.id);
    onError('');
    onNotice('');
    try {
      const payload = {
        isSuperAdmin: editIsSuperAdmin,
        privileges: editIsSuperAdmin ? ['*'] : editPrivileges,
      };
      const updated = await api(`/admin/admins/${editingAdmin.id}`, {
        method: 'PATCH',
        ...jsonBody(payload),
      });
      onNotice(`Privileges for ${updated.fullName} updated successfully.`);
      setEditingAdmin(null);
      await loadAdmins();
    } catch (cause) {
      onError(cause.message);
    } finally {
      setBusyAdminId(null);
    }
  }

  async function toggleAdminStatus(admin, newStatus) {
    setBusyAdminId(admin.id);
    onError('');
    onNotice('');
    try {
      const updated = await api(`/admin/admins/${admin.id}`, {
        method: 'PATCH',
        ...jsonBody({ status: newStatus }),
      });
      onNotice(
        newStatus === 'ACTIVE'
          ? `Administrator ${admin.fullName} reactivated.`
          : `Administrator ${admin.fullName} deactivated. All their active sessions were revoked.`
      );
      await loadAdmins();
    } catch (cause) {
      onError(cause.message);
    } finally {
      setBusyAdminId(null);
    }
  }

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>ADMINISTRATION</p>
          <h3>Administrator accounts & RBAC privilege management</h3>
        </div>
        <button
          className='primary-button'
          type='button'
          onClick={() => {
            setAddModalOpen(true);
            setAddIsSuperAdmin(false);
            setAddPrivileges([]);
          }}
        >
          + Add New Admin
        </button>
      </div>

      {/* Add New Admin Modal / Drawer */}
      {addModalOpen && (
        <div className='surface form-surface' style={{ margin: '16px 0', border: '2px solid var(--line)' }}>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>CREATE ADMINISTRATOR</p>
              <h3>New administrator details</h3>
            </div>
            <button className='secondary-button' type='button' onClick={() => setAddModalOpen(false)}>✕ Cancel</button>
          </div>
          <form className='form-stack' onSubmit={submitAddAdmin} style={{ marginTop: '14px' }}>
            <div className='profile-form-grid'>
              <label className='field'>
                <span>Full name</span>
                <input name='fullName' placeholder='e.g. Abebe Kebede' minLength='2' maxLength='120' required />
              </label>
              <label className='field'>
                <span>Ethiopian phone (9 digits, 9... or 7...)</span>
                <input name='phoneNumber' placeholder='911223344' pattern='[97][0-9]{8}' maxLength='9' required />
              </label>
              <label className='field'>
                <span>Password</span>
                <input name='password' type='password' minLength='6' maxLength='128' autoComplete='new-password' required />
              </label>
              <label className='field'>
                <span>Confirm password</span>
                <input name='confirmPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required />
              </label>
            </div>

            {/* Super admin toggle */}
            <div style={{ marginTop: '8px' }}>
              <label className='field checkbox-field' style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type='checkbox'
                  checked={addIsSuperAdmin}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAddIsSuperAdmin(checked);
                    if (checked) {
                      setAddPrivileges(ALL_PRIVILEGES_LIST.map((p) => p.key));
                    }
                  }}
                />
                <strong>Super Administrator (Full unrestricted access across all modules)</strong>
              </label>
            </div>

            {/* Privilege Selection */}
            {!addIsSuperAdmin && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <p className='eyebrow' style={{ margin: 0 }}>ASSIGN SPECIFIC MODULE PRIVILEGES</p>
                  <div className='button-row compact'>
                    <button
                      type='button'
                      className='secondary-button'
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setAddPrivileges(ALL_PRIVILEGES_LIST.map((p) => p.key))}
                    >
                      Select all
                    </button>
                    <button
                      type='button'
                      className='secondary-button'
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setAddPrivileges([])}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                  {ALL_PRIVILEGES_LIST.map((p) => (
                    <label
                      key={p.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        background: addPrivileges.includes(p.key) ? '#e0f2fe' : '#f9fafb',
                        border: '1px solid #e5e7eb',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      <input
                        type='checkbox'
                        checked={addPrivileges.includes(p.key)}
                        onChange={() => toggleAddPrivilege(p.key)}
                      />
                      <span><strong>{p.key}</strong><br /><small style={{ opacity: 0.7 }}>{p.label}</small></span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className='button-row' style={{ marginTop: '16px' }}>
              <button className='primary-button' type='submit' disabled={addBusy}>
                {addBusy ? 'Creating administrator…' : 'Create Administrator'} <span>↗</span>
              </button>
              <button className='secondary-button' type='button' onClick={() => setAddModalOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Admin Privileges Modal */}
      {editingAdmin && (
        <div className='surface form-surface' style={{ margin: '16px 0', border: '2px solid #0284c7' }}>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>MANAGE PRIVILEGES</p>
              <h3>Edit access for {editingAdmin.fullName} ({editingAdmin.phoneNumber})</h3>
            </div>
            <button className='secondary-button' type='button' onClick={() => setEditingAdmin(null)}>✕ Cancel</button>
          </div>
          <form className='form-stack' onSubmit={submitEditPrivileges} style={{ marginTop: '14px' }}>
            <label className='field checkbox-field' style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type='checkbox'
                checked={editIsSuperAdmin}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setEditIsSuperAdmin(checked);
                  if (checked) {
                    setEditPrivileges(ALL_PRIVILEGES_LIST.map((p) => p.key));
                  }
                }}
              />
              <strong>Super Administrator (Full unrestricted access)</strong>
            </label>

            {!editIsSuperAdmin && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <p className='eyebrow' style={{ margin: 0 }}>ASSIGN SPECIFIC MODULE PRIVILEGES</p>
                  <div className='button-row compact'>
                    <button
                      type='button'
                      className='secondary-button'
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setEditPrivileges(ALL_PRIVILEGES_LIST.map((p) => p.key))}
                    >
                      Select all
                    </button>
                    <button
                      type='button'
                      className='secondary-button'
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setEditPrivileges([])}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                  {ALL_PRIVILEGES_LIST.map((p) => (
                    <label
                      key={p.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        background: editPrivileges.includes(p.key) ? '#e0f2fe' : '#f9fafb',
                        border: '1px solid #e5e7eb',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      <input
                        type='checkbox'
                        checked={editPrivileges.includes(p.key)}
                        onChange={() => toggleEditPrivilege(p.key)}
                      />
                      <span><strong>{p.key}</strong><br /><small style={{ opacity: 0.7 }}>{p.label}</small></span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className='button-row' style={{ marginTop: '16px' }}>
              <button className='primary-button' type='submit' disabled={busyAdminId === editingAdmin.id}>
                {busyAdminId === editingAdmin.id ? 'Saving…' : 'Save Privileges'} <span>↗</span>
              </button>
              <button className='secondary-button' type='button' onClick={() => setEditingAdmin(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <Empty>Loading administrators…</Empty>
      ) : admins.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Administrator</th>
                <th>Phone</th>
                <th>Role / Access</th>
                <th>Privileges</th>
                <th>Status</th>
                <th>Registered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const isSelf = admin.id === user?.id;
                const privs = Array.isArray(admin.privileges) ? admin.privileges : [];
                return (
                  <tr key={admin.id}>
                    <td>
                      <strong>{admin.fullName}</strong>
                      {isSelf && <small style={{ marginLeft: '6px', color: '#0369a1', fontWeight: 600 }}>(You)</small>}
                    </td>
                    <td>{admin.phoneNumber}</td>
                    <td>
                      {admin.isSuperAdmin ? (
                        <span className='status-badge status-approved'>SUPER ADMIN</span>
                      ) : (
                        <span className='status-badge'>ADMIN</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxWidth: '280px' }}>
                        {admin.isSuperAdmin || privs.includes('*') ? (
                          <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>All Privileges (*)</span>
                        ) : privs.length ? (
                          privs.slice(0, 4).map((pr) => (
                            <span key={pr} style={{ fontSize: '10px', background: '#f3f4f6', padding: '2px 5px', borderRadius: '3px' }}>
                              {pr}
                            </span>
                          )).concat(privs.length > 4 ? [<span key='more' style={{ fontSize: '10px', opacity: 0.6 }}>+{privs.length - 4} more</span>] : [])
                        ) : (
                          <span style={{ fontSize: '11px', opacity: 0.5 }}>None</span>
                        )}
                      </div>
                    </td>
                    <td><StatusBadge status={admin.status} /></td>
                    <td>{new Date(admin.registeredAt).toLocaleDateString()}</td>
                    <td>
                      <div className='button-row compact'>
                        <button
                          className='secondary-button'
                          type='button'
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => {
                            setEditingAdmin(admin);
                            setEditIsSuperAdmin(Boolean(admin.isSuperAdmin));
                            setEditPrivileges(
                              admin.isSuperAdmin ? ALL_PRIVILEGES_LIST.map((p) => p.key) : privs
                            );
                          }}
                        >
                          Privileges
                        </button>

                        {admin.status === 'ACTIVE' ? (
                          <button
                            className='secondary-button'
                            type='button'
                            style={{
                              padding: '3px 8px',
                              fontSize: '11px',
                              color: isSelf ? '#9ca3af' : '#dc2626',
                              borderColor: isSelf ? '#e5e7eb' : '#fca5a5',
                            }}
                            disabled={isSelf || busyAdminId === admin.id}
                            title={isSelf ? 'You cannot deactivate your own account' : 'Deactivate admin'}
                            onClick={() => {
                              if (window.confirm(`Are you sure you want to deactivate administrator ${admin.fullName}? All active sessions will be revoked.`)) {
                                toggleAdminStatus(admin, 'DEACTIVATED');
                              }
                            }}
                          >
                            {busyAdminId === admin.id ? '…' : 'Deactivate'}
                          </button>
                        ) : (
                          <button
                            className='secondary-button'
                            type='button'
                            style={{ padding: '3px 8px', fontSize: '11px', color: '#16a34a', borderColor: '#86efac' }}
                            disabled={busyAdminId === admin.id}
                            onClick={() => toggleAdminStatus(admin, 'ACTIVE')}
                          >
                            {busyAdminId === admin.id ? '…' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No administrators found.</Empty>
      )}
    </section>
  );
}

function AdminPasswordPage({ onError, onNotice }) {
  const [busy, setBusy] = useState(false);

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true);
    onError('');
    onNotice('');
    try {
      await api('/profile/password', { method: 'PATCH', ...jsonBody(data) });
      form.reset();
      onNotice('Your admin password was changed. Other active sessions were signed out.');
    } catch (cause) {
      onError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className='surface form-surface form-stack'>
      <div className='surface-heading'>
        <div><p className='eyebrow'>ACCOUNT SECURITY</p><h3>Change admin password</h3></div>
      </div>
      <p className='form-subtitle'>Confirm your current password to set a new one. Your existing password cannot be viewed.</p>
      <form className='form-stack' onSubmit={changePassword}>
        <label className='field'><span>Current password</span><input name='currentPassword' type='password' autoComplete='current-password' required /></label>
        <label className='field'><span>New password</span><input name='newPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required /></label>
        <label className='field'><span>Confirm new password</span><input name='confirmNewPassword' type='password' minLength='6' maxLength='128' autoComplete='new-password' required /></label>
        <button className='primary-button' type='submit' disabled={busy}>{busy ? 'Changing password…' : 'Change password'}<span>↗</span></button>
      </form>
    </section>
  );
}

function AdminProductsPage({ products, onUploadImage }) {
  const [items, setItems] = useState(products ?? []);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    price: '300.00',
    dailyRate: '24',
    durationDays: 30,
    description: '',
    status: 'AVAILABLE',
    imageUrl: '',
    availableFrom: '',
    availableUntil: '',
    displayOrder: 1,
  });

  useEffect(() => {
    setItems(products ?? []);
  }, [products]);

  const refreshProducts = async () => {
    const refreshed = await api('/admin/products');
    setItems(refreshed);
  };

  const handleEdit = (product) => {
    setEditingId(product.id);
    setForm({
      name: product.name ?? '',
      price: String(product.price ?? '300.00'),
      dailyRate: String(rateFraction(product.dailyRate ?? 0.24) * 100),
      durationDays: Number(product.durationDays ?? 30),
      description: product.description ?? '',
      status: product.status ?? 'AVAILABLE',
      imageUrl: getProductImage(product),
      availableFrom: product.availableFrom ? new Date(product.availableFrom).toISOString().slice(0, 16) : '',
      availableUntil: product.availableUntil ? new Date(product.availableUntil).toISOString().slice(0, 16) : '',
      displayOrder: Number(product.displayOrder ?? 1),
    });
    setError('');
    setNotice('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const clearExpiredSchedule = form.status === 'COMING_SOON'
        && form.availableFrom
        && new Date(form.availableFrom) <= new Date();
      const payload = {
        ...form,
        price: String(form.price),
        dailyRate: String(Number(form.dailyRate) / 100),
        durationDays: Number(form.durationDays),
        displayOrder: Number(form.displayOrder),
        imageUrl: form.imageUrl || null,
        availableFrom: form.availableFrom && !clearExpiredSchedule ? new Date(form.availableFrom).toISOString() : null,
        availableUntil: form.availableUntil && !clearExpiredSchedule ? new Date(form.availableUntil).toISOString() : null,
      };

      const handleImageUpload = async (file) => {
        if (!file) return;
        setError('');
        setImageUploading(true);
        try {
          const uploaded = await onUploadImage(file);
          setForm((current) => ({ ...current, imageUrl: uploaded.imageUrl }));
          setNotice('Product image uploaded. Save the product to apply it.');
        } catch (cause) {
          setError(cause.message || 'Unable to upload product image.');
        } finally {
          setImageUploading(false);
        }
      };

      if (editingId) {
        await api(`/admin/products/${editingId}`, { method: 'PUT', ...jsonBody(payload) });
        setNotice('Product updated successfully.');
      } else {
        await api('/admin/products', { method: 'POST', ...jsonBody(payload) });
        setNotice('Product created successfully.');
      }
      setEditingId(null);
      setForm({
        name: '',
        price: '300.00',
        dailyRate: '24',
        durationDays: 30,
        description: '',
        status: 'AVAILABLE',
        imageUrl: '',
        availableFrom: '',
        availableUntil: '',
        displayOrder: items.length + 1,
      });
      await refreshProducts();
    } catch (cause) {
      setError(cause.message || 'Unable to save product.');
    }
  };

  const handleToggleStatus = async (product, newStatus) => {
    try {
      await api(`/admin/products/${product.id}`, {
        method: 'PUT',
        ...jsonBody({
          name: product.name,
          price: String(product.price),
          dailyRate: String(product.dailyRate),
          durationDays: Number(product.durationDays),
          status: newStatus,
          ...(newStatus === 'COMING_SOON' ? { availableFrom: null, availableUntil: null } : {}),
        }),
      });
      await refreshProducts();
      setNotice(`Product status changed to ${newStatus}.`);
    } catch (cause) {
      setError(cause.message);
    }
  };

  return (
    <section className='surface form-surface form-stack'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>PRODUCT MANAGEMENT</p>
          <h3>Add & Configure Products</h3>
        </div>
      </div>

      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}

      <form onSubmit={handleSubmit} className='surface nested-surface form-stack'>
        <div className='profile-form-grid'>
          <label className='field'>
            <span>Product Name *</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='e.g. Product 8,000' required />
          </label>
          <label className='field'>
            <span>Status</span>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value='AVAILABLE'>AVAILABLE</option>
              <option value='COMING_SOON'>COMING SOON</option>
              <option value='DISABLED'>DISABLED</option>
              <option value='DRAFT'>DRAFT</option>
            </select>
          </label>
        </div>

        <div className='profile-form-grid'>
          <label className='field'>
            <span>Price (ETB) *</span>
            <input type='number' step='0.01' value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </label>
          <label className='field'>
            <span>Daily Rate (%) *</span>
            <input type='number' min='0' step='0.01' value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} required />
            <small>Daily Income: {money(Number(form.price || 0) * Number(form.dailyRate || 0) / 100)} / day</small>
          </label>
        </div>

        <div className='profile-form-grid'>
          <label className='field'>
            <span>Duration (Days) *</span>
            <input type='number' min='1' value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} required />
          </label>
          <label className='field'>
            <span>Display Order</span>
            <input type='number' min='0' value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
          </label>
        </div>

        <div className='profile-form-grid'>
          <label className='field'>
            <span>Scheduled Available From (Optional)</span>
            <input type='datetime-local' value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} />
            <small>A future date delays an AVAILABLE product. COMING SOON products stay unavailable until you change their status.</small>
          </label>
          <label className='field'>
            <span>Scheduled Available Until (Optional)</span>
            <input type='datetime-local' value={form.availableUntil} onChange={(e) => setForm({ ...form, availableUntil: e.target.value })} />
          </label>
        </div>

        <label className='field'>
          <span>Product Image URL</span>
          <input type='url' value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder='https://example.com/product-image.webp' />
          <span className='image-upload-control'>
            <input type='file' accept='image/jpeg,image/png,image/webp' disabled={imageUploading} onChange={(event) => { handleImageUpload(event.target.files?.[0]); event.target.value = ''; }} />
            <small>{imageUploading ? 'Uploading image…' : 'Or choose a JPG, PNG, or WEBP image (up to 5 MB). Save the product to apply changes.'}</small>
          </span>
          <img className='admin-product-image-preview' src={getProductImage({ imageUrl: form.imageUrl, displayOrder: form.displayOrder })} alt='Product image preview' />
        </label>

        <label className='field'>
          <span>Description</span>
          <textarea rows='2' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder='Product benefits and details' />
        </label>

        <div className='button-row'>
          <button className='primary-button' type='submit' disabled={imageUploading}>
            {editingId ? 'Update Product' : 'Add New Product'} <span>↗</span>
          </button>
          {editingId && (
            <button className='secondary-button' type='button' onClick={() => { setEditingId(null); setForm({ name: '', price: '300.00', dailyRate: '24', durationDays: 30, description: '', status: 'AVAILABLE', imageUrl: '', availableFrom: '', availableUntil: '', displayOrder: items.length + 1 }); }}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className='surface-heading' style={{ marginTop: '20px' }}>
        <div>
          <p className='eyebrow'>CATALOG</p>
          <h3>Existing Packages ({items.length})</h3>
        </div>
      </div>

      {items.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                <th>Price</th>
                <th>Daily Income</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Schedule</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => {
                const normalizedRate = rateFraction(product.dailyRate);
                const dailyInc = Number(product.price) * normalizedRate;
                return (
                  <tr key={product.id}>
                    <td><img className='admin-product-image-thumb' src={getProductImage(product)} alt={`${product.name} product`} /></td>
                    <td><strong>{product.name}</strong></td>
                    <td>{money(product.price)}</td>
                    <td><strong className='highlight-green'>{money(dailyInc)} / day ({Math.round(normalizedRate * 100)}%)</strong></td>
                    <td>{product.durationDays} days</td>
                    <td>
                      <span className={`product-status ${String(product.status).toLowerCase()}`}>
                        {product.status}
                      </span>
                    </td>
                    <td>
                      {product.availableFrom ? (
                        <small>From: {new Date(product.availableFrom).toLocaleString()}</small>
                      ) : 'Immediate'}
                    </td>
                    <td>
                      <div className='button-row compact'>
                        <button type='button' className='secondary-button' onClick={() => handleEdit(product)}>
                          Edit
                        </button>
                        {product.status === 'AVAILABLE' ? (
                          <button type='button' className='secondary-button' onClick={() => handleToggleStatus(product, 'COMING_SOON')}>
                            Set Coming Soon
                          </button>
                        ) : (
                          <button type='button' className='secondary-button' onClick={() => handleToggleStatus(product, 'AVAILABLE')}>
                            Set Available
                          </button>
                        )}
                        <button type='button' className='secondary-button' onClick={() => handleToggleStatus(product, product.status === 'DISABLED' ? 'AVAILABLE' : 'DISABLED')}>
                          {product.status === 'DISABLED' ? 'Enable' : 'Disable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>No products found.</Empty>}
    </section>
  );
}

function AdminPaymentMethodsPage({ methods }) {
  const [items, setItems] = useState(methods ?? []);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    type: 'BANK',
    accountNumber: '',
    accountName: '',
    phoneNumber: '',
    instructions: '',
    isActive: true,
    displayOrder: 0,
  });

  useEffect(() => {
    setItems(methods ?? []);
  }, [methods]);

  const refreshMethods = async () => {
    const refreshed = await api('/admin/payment-methods');
    setItems(refreshed);
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      ...form,
      accountNumber: form.accountNumber || null,
      accountName: form.accountName || null,
      phoneNumber: form.phoneNumber || null,
      instructions: form.instructions || '',
      isActive: Boolean(form.isActive),
      displayOrder: Number(form.displayOrder || 0),
    };
    if (editingId) {
      await api(`/admin/payment-methods/${editingId}`, { method: 'PUT', ...jsonBody(payload) });
    } else {
      await api('/admin/payment-methods', { method: 'POST', ...jsonBody(payload) });
    }
    setForm({ name: '', type: 'BANK', accountNumber: '', accountName: '', phoneNumber: '', instructions: '', isActive: true, displayOrder: 0 });
    setEditingId(null);
    await refreshMethods();
  };

  const editMethod = (method) => {
    setEditingId(method.id);
    setForm({
      name: method.name ?? '',
      type: method.type ?? 'BANK',
      accountNumber: method.accountNumber ?? '',
      accountName: method.accountName ?? '',
      phoneNumber: method.phoneNumber ?? '',
      instructions: method.instructions ?? '',
      isActive: Boolean(method.isActive),
      displayOrder: method.displayOrder ?? 0,
    });
  };

  const toggleState = async (method, isActive) => {
    await api(`/admin/payment-methods/${method.id}`, { method: 'PUT', ...jsonBody({ ...method, isActive }) });
    await refreshMethods();
  };

  return (
    <section className='surface form-surface form-stack'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>PAYMENT METHODS</p>
          <h3>Bank and wallet methods</h3>
        </div>
      </div>

      <form onSubmit={submit} className='surface nested-surface form-stack'>
        <div className='profile-form-grid'>
          <label className='field'><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className='field'><span>Type</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value='BANK'>BANK</option><option value='MOBILE'>MOBILE</option></select></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>Account number</span><input value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} /></label>
          <label className='field'><span>Account name</span><input value={form.accountName} onChange={(event) => setForm({ ...form, accountName: event.target.value })} /></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>Phone number</span><input value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} /></label>
          <label className='field'><span>Display order</span><input type='number' min='0' value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) })} /></label>
        </div>
        <label className='field'><span>Instructions</span><textarea rows='3' value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
        <label className='field checkbox-field'><input type='checkbox' checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>Active</span></label>
        <button className='primary-button' type='submit'>{editingId ? 'Update method' : 'Add method'}<span>↗</span></button>
      </form>

      {items.length ? (
        <div className='table-wrap'>
          <table>
            <thead><tr><th>Name</th><th>Account</th><th>Owner</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((method) => (
                <tr key={method.id}>
                  <td>{method.name}</td>
                  <td>{method.accountNumber ?? method.phoneNumber ?? '—'}</td>
                  <td>{method.accountName ?? method.phoneNumber ?? '—'}</td>
                  <td>{method.isActive ? 'Active' : 'Disabled'}</td>
                  <td>
                    <div className='button-row compact'>
                      <button type='button' className='secondary-button' onClick={() => editMethod(method)}>Edit</button>
                      <button type='button' className='secondary-button' onClick={() => toggleState(method, !method.isActive)}>{method.isActive ? 'Disable' : 'Enable'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No payment methods found.</Empty>}
    </section>
  );
}

function AdminRechargesPage() {
  const [items, setItems] = useState([]);
  const [proofPreview, setProofPreview] = useState(null);
  const [proofZoom, setProofZoom] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0, limit: 10 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const result = await api(`/admin/recharges?${params}`);
      setItems(result.items);
      setPagination(result.pagination);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [page, limit, status, search]);

  useEffect(() => {
    if (!proofPreview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setProofPreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [proofPreview]);

  const openProof = (item) => {
    setProofZoom(1);
    setProofPreview({
      url: `/api/admin/recharges/${item.id}/proof?inline=1`,
      name: `${item.fullName || item.userId} payment proof`,
    });
  };

  const review = async (id, action, note = '') => {
    try {
      await api(`/admin/recharges/${id}/${action}`, { method: 'POST', ...jsonBody({ note }) });
      await refresh();
    } catch (cause) {
      setError(cause.message);
    }
  };

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>RECHARGES</p>
          <h3>Manual review queue</h3>
        </div>
      </div>
      <AdminTableFilters
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1); }}
        status={status}
        onStatus={(value) => { setStatus(value); setPage(1); }}
        statuses={['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED']}
        limit={limit}
        onLimit={(value) => { setLimit(value); setPage(1); }}
        placeholder='Search customer, phone, sender or reference'
      />
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {loading ? <p className='empty-state' role='status'>Loading recharge requests…</p> : items.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr><th>User</th><th>Phone Number</th><th>Amount</th><th>Method</th><th>Sender</th><th>Reference</th><th>Status</th><th>Proof</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.fullName || item.userId}</td>
                  <td>{item.phoneNumber || '—'}</td>
                  <td>{money(item.amount)}</td>
                  <td>{item.paymentMethod}</td>
                  <td>{item.senderName}</td>
                  <td>{item.transactionReference}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>
                    {item.hasProof ? (
                      item.proofIsImage ? (
                        <button className='admin-recharge-proof-button' type='button' onClick={() => openProof(item)} aria-label={`Zoom payment proof for ${item.fullName || item.userId}`}>
                          <img className='admin-recharge-proof-preview' src={`/api/admin/recharges/${item.id}/proof?inline=1`} alt='Payment proof thumbnail' loading='lazy' />
                          <span>Zoom image</span>
                        </button>
                      ) : (
                        <a href={`/api/admin/recharges/${item.id}/proof`} target='_blank' rel='noreferrer'>Open PDF proof</a>
                      )
                    ) : 'No proof'}
                  </td>
                  <td>
                    <div className='button-row compact'>
                      <button type='button' className='secondary-button' onClick={() => review(item.id, 'review')}>Under review</button>
                      <button type='button' className='primary-button' onClick={() => review(item.id, 'approve')}>Approve</button>
                      <button type='button' className='secondary-button' onClick={() => review(item.id, 'reject', 'Rejected by admin')}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No recharge requests found.</Empty>}
      <AdminTablePagination pagination={pagination} page={page} setPage={setPage} loading={loading} />
      {proofPreview && (
        <div className='proof-viewer-backdrop' role='presentation' onClick={(event) => {
          if (event.target === event.currentTarget) setProofPreview(null);
        }}>
          <section className='proof-viewer' role='dialog' aria-modal='true' aria-label={proofPreview.name}>
            <div className='proof-viewer-toolbar'>
              <strong>{proofPreview.name}</strong>
              <div className='proof-viewer-actions'>
                <button type='button' className='secondary-button' onClick={() => setProofZoom((zoom) => Math.max(0.5, Number((zoom - 0.25).toFixed(2))))} aria-label='Zoom out'><ZoomOut size={17} /></button>
                <span>{Math.round(proofZoom * 100)}%</span>
                <button type='button' className='secondary-button' onClick={() => setProofZoom((zoom) => Math.min(3, Number((zoom + 0.25).toFixed(2))))} aria-label='Zoom in'><ZoomIn size={17} /></button>
                <button type='button' className='secondary-button' onClick={() => setProofZoom(1)}>Reset</button>
                <button type='button' className='secondary-button' onClick={() => setProofPreview(null)} aria-label='Close proof viewer'><X size={17} /></button>
              </div>
            </div>
            <div className='proof-viewer-image-wrap'>
              <img src={proofPreview.url} alt={proofPreview.name} style={{ transform: `scale(${proofZoom})` }} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function AdminWithdrawalsPage() {
  const [items, setItems] = useState([]);
  const [withdrawalFee, setWithdrawalFee] = useState('10');
  const [savingFee, setSavingFee] = useState(false);
  const [notes, setNotes] = useState({});
  const [pendingId, setPendingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0, limit: 10 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const result = await api(`/admin/withdrawals?${params}`);
      setItems(result.items);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setError('');
    refresh().catch((cause) => setError(cause.message));
  }, [page, limit, status, search]);

  useEffect(() => {
    api('/admin/settings')
      .then((settings) => setWithdrawalFee(String(settings.withdrawalFee ?? 10)))
      .catch((cause) => setError(cause.message));
  }, []);

  async function saveWithdrawalFee(event) {
    event.preventDefault();
    const percentage = Number(withdrawalFee);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setError('Withdrawal fee must be between 0% and 100%.');
      return;
    }
    setSavingFee(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/settings', { method: 'PUT', ...jsonBody({ withdrawalFee: percentage }) });
      setWithdrawalFee(String(percentage));
      setNotice('Withdrawal fee updated successfully.');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSavingFee(false);
    }
  }

  async function review(id, action) {
    const note = notes[id]?.trim() ?? '';
    if (action === 'reject' && !note) {
      setError('Enter a reason before rejecting this withdrawal.');
      return;
    }
    setPendingId(id);
    setError('');
    try {
      await api(`/admin/withdrawals/${id}/${action}`, { method: 'POST', ...jsonBody({ note }) });
      await refresh();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setPendingId(null);
    }
  }

  async function copyPayoutAccount(value) {
    if (!value) {
      setError('No payout account number is available to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(String(value));
      setNotice('Payout account number copied.');
      setError('');
    } catch {
      setError('Could not copy the payout account number. Check clipboard permissions.');
    }
  }

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>WITHDRAWALS</p>
          <h3>Withdrawal processing queue</h3>
        </div>
      </div>
      <form className='withdrawal-fee-settings' onSubmit={saveWithdrawalFee}>
        <label className='field'>
          <span>Customer withdrawal fee (%)</span>
          <input type='number' min='0' max='100' step='0.01' value={withdrawalFee} onChange={(event) => setWithdrawalFee(event.target.value)} required />
          <small>Deducted as a percentage of the requested withdrawal. Initial fee: 10%.</small>
        </label>
        <button className='primary-button' type='submit' disabled={savingFee}>{savingFee ? 'Saving…' : 'Save fee'}<span>↗</span></button>
      </form>
      <AdminTableFilters
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1); }}
        status={status}
        onStatus={(value) => { setStatus(value); setPage(1); }}
        statuses={['PENDING', 'PROCESSING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED']}
        limit={limit}
        onLimit={(value) => { setLimit(value); setPage(1); }}
        placeholder='Search customer, phone or payout account'
      />
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}
      {loading ? <p className='empty-state' role='status'>Loading withdrawal requests…</p> : items.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr><th>Customer</th><th>Amount</th><th>Fee / Net</th><th>Full payout details</th><th>Status</th><th>Requested</th><th>Admin note</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const actionable = ['PENDING', 'PROCESSING'].includes(item.status);
                const isPending = pendingId === item.id;
                return (
                  <tr key={item.id}>
                    <td>{item.fullName}<small>{item.phoneNumber}</small></td>
                    <td>{money(item.amount)}</td>
                    <td>{money(item.fee)} fee<small>{money(item.netAmount)} net</small></td>
                    <td>
                      {item.paymentMethod}
                      <small><strong className='payout-account-number'>{item.accountNumber || item.accountPhone || '—'}</strong></small>
                      <button type='button' className='secondary-button copy-account-button' onClick={() => copyPayoutAccount(item.accountNumber || item.accountPhone)}>Copy account</button>
                      {item.accountHolderName && <small>{item.accountHolderName}</small>}
                    </td>
                    <td><StatusBadge status={item.status} /></td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.adminNote || '—'}</td>
                    <td>
                      {actionable ? (
                        <div className='form-stack'>
                          <input
                            aria-label={`Admin note for ${item.fullName}`}
                            value={notes[item.id] ?? ''}
                            onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder='Optional note; required to reject'
                            maxLength={1000}
                          />
                          <div className='button-row compact'>
                            {item.status === 'PENDING' && <button type='button' className='secondary-button' disabled={isPending} onClick={() => review(item.id, 'process')}>Process</button>}
                            <button type='button' className='primary-button' disabled={isPending} onClick={() => review(item.id, 'complete')}>Complete</button>
                            <button type='button' className='secondary-button' disabled={isPending} onClick={() => review(item.id, 'reject')}>Reject</button>
                          </div>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>No withdrawal requests found.</Empty>}
      <AdminTablePagination pagination={pagination} page={page} setPage={setPage} loading={loading || pendingId !== null} />
    </section>
  );
}

function AdminAuditLogsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState({ items: [], pagination: { page: 1, pages: 0, total: 0, limit: 10 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (action.trim()) params.set('action', action.trim());
    if (entityType.trim()) params.set('entityType', entityType.trim());
    if (search.trim()) params.set('search', search.trim());
    api(`/admin/audit-logs?${params}`)
      .then(setResult)
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [page, limit, action, entityType, search]);

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>SECURITY & ACCOUNTABILITY</p>
          <h3>Administrative audit log</h3>
        </div>
        <div className='admin-table-filters'>
          <label className='field'><span>Search logs</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder='Search action, entity or admin' /></label>
          <label className='field'><span>Action</span><input value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} placeholder='Filter by action' /></label>
          <label className='field'><span>Entity type</span><input value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }} placeholder='Filter by entity' /></label>
          <label className='field'><span>Rows per page</span><select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>
      </div>
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {loading ? <p className='empty-state' role='status'>Loading audit events…</p> : result.items.length ? (
        <>
          <div className='table-wrap'>
            <table>
              <thead>
                <tr><th>Date</th><th>Administrator</th><th>Action</th><th>Entity</th><th>Changes</th></tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.adminName || 'Unknown admin'}<small>{item.adminId}</small></td>
                    <td>{item.action}</td>
                    <td>{item.entityType}<small>{item.entityId || '—'}</small></td>
                    <td>
                      <details className='audit-changes'>
                        <summary>View changes</summary>
                        <pre>{JSON.stringify({ oldValue: item.oldValue, newValue: item.newValue }, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <Empty>No audit events found.</Empty>}
      <AdminTablePagination pagination={result.pagination} page={page} setPage={setPage} loading={loading} noun='events' />
    </section>
  );
}

function AdminRewardsPage({ onError, onNotice }) {
  const [claims, setClaims] = useState([]);
  const [rules, setRules] = useState([]);
  const [status, setStatus] = useState('');
  const [editingRule, setEditingRule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rejectingId, setRejectingId] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const refresh = async () => {
    try {
      const [claimData, ruleData] = await Promise.all([api('/admin/rewards'), api('/admin/rewards/rules')]);
      setClaims(claimData);
      setRules(ruleData);
    } catch (cause) {
      onError(cause.message);
    }
  };
  useEffect(() => { refresh(); }, []);

  const saveRule = async (event) => {
    event.preventDefault();
    setSaving(true);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.thresholdAmount = Number(data.thresholdAmount);
    data.rewardAmount = Number(data.rewardAmount);
    try {
      await api(editingRule?.id ? `/admin/rewards/rules/${editingRule.id}` : '/admin/rewards/rules', {
        method: editingRule?.id ? 'PATCH' : 'POST',
        ...jsonBody(data),
      });
      setEditingRule(null);
      onNotice('Reward rule saved successfully.');
      await refresh();
    } catch (cause) {
      onError(cause.message);
    } finally {
      setSaving(false);
    }
  };

  const reviewClaim = async (claimId, action, note) => {
    try {
      await api(`/admin/rewards/${claimId}/${action}`, { method: 'POST', ...jsonBody({ note }) });
      setRejectingId('');
      setRejectNote('');
      onNotice(`Reward claim ${action === 'paid' ? 'marked paid' : `${action}d`} successfully.`);
      await refresh();
    } catch (cause) {
      onError(cause.message);
    }
  };

  const visibleClaims = status ? claims.filter((claim) => claim.status === status) : claims;
  const formValues = editingRule ?? {
    name: '',
    ruleType: 'MILESTONE',
    thresholdAmount: 5000,
    rewardAmount: 500,
    frequency: 'ONCE',
    status: 'ACTIVE',
  };

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div><p className='eyebrow'>REWARDS</p><h3>Claims and reward rules</h3></div>
      </div>
      <div className='surface form-surface form-stack'>
        <h4>{editingRule ? 'Edit reward rule' : 'Add reward rule'}</h4>
        <p className='form-subtitle'>Milestone eligibility uses the customer’s approved, credited deposits. Reward amounts and thresholds are enforced by the server.</p>
        <form key={editingRule?.id ?? 'new-rule'} className='form-stack' onSubmit={saveRule}>
          <div className='profile-form-grid'>
            <label className='field'><span>Rule name</span><input name='name' defaultValue={formValues.name} maxLength='120' required /></label>
            <label className='field'><span>Type</span><select name='ruleType' defaultValue={formValues.ruleType}><option value='MILESTONE'>Milestone</option><option value='DAILY'>Daily</option><option value='WEEKLY'>Weekly</option></select></label>
          </div>
          <div className='profile-form-grid'>
            <label className='field'><span>Qualifying deposits (ETB)</span><input type='number' name='thresholdAmount' min='0' max='1000000000' step='0.01' defaultValue={formValues.thresholdAmount} required /></label>
            <label className='field'><span>Reward amount (ETB)</span><input type='number' name='rewardAmount' min='0' max='1000000000' step='0.01' defaultValue={formValues.rewardAmount} required /></label>
          </div>
          <div className='profile-form-grid'>
            <label className='field'><span>Frequency</span><select name='frequency' defaultValue={formValues.frequency}><option value='ONCE'>Once</option><option value='DAILY'>Daily</option><option value='WEEKLY'>Weekly</option></select></label>
            <label className='field'><span>Status</span><select name='status' defaultValue={formValues.status}><option value='ACTIVE'>Active</option><option value='DISABLED'>Disabled</option></select></label>
          </div>
          <div className='button-row'>
            <button className='primary-button' type='submit' disabled={saving}>{saving ? 'Saving…' : editingRule ? 'Update rule' : 'Add rule'}</button>
            {editingRule && <button className='secondary-button' type='button' onClick={() => setEditingRule(null)}>Cancel</button>}
          </div>
        </form>
        <div className='table-wrap'>
          <table>
            <thead><tr><th>Rule</th><th>Type</th><th>Threshold</th><th>Reward</th><th>Frequency</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.name}</td><td>{rule.ruleType}</td><td>{money(rule.thresholdAmount)}</td><td>{money(rule.rewardAmount)}</td><td>{rule.frequency}</td><td><StatusBadge status={rule.status} /></td>
                <td><button type='button' className='secondary-button' onClick={() => setEditingRule(rule)}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className='surface-heading'>
        <div><p className='eyebrow'>MANUAL REVIEW</p><h3>Reward claims</h3></div>
        <label className='field'><span>Filter status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value=''>All statuses</option>{['PENDING', 'APPROVED', 'REJECTED', 'PAID'].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {visibleClaims.length ? (
        <div className='table-wrap'>
          <table>
            <thead><tr><th>Customer</th><th>Phone</th><th>Reward</th><th>Threshold</th><th>Amount</th><th>Status</th><th>Requested</th><th>Review</th></tr></thead>
            <tbody>{visibleClaims.map((claim) => (
              <tr key={claim.id}>
                <td>{claim.fullName}</td><td>{claim.phoneNumber}</td><td>{claim.name}</td><td>{money(claim.thresholdAmount)}</td><td>{money(claim.amount)}</td>
                <td><StatusBadge status={claim.status} />{claim.adminNote && <small>{claim.adminNote}</small>}</td>
                <td>{claim.requestedAt ? new Date(claim.requestedAt).toLocaleString() : new Date(claim.createdAt).toLocaleString()}</td>
                <td>
                  {claim.status === 'PENDING' && (rejectingId === claim.id ? (
                    <div className='form-stack'>
                      <input aria-label='Rejection reason' value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} maxLength='500' placeholder='Reason for rejection' />
                      <div className='button-row compact'>
                        <button type='button' className='primary-button' disabled={!rejectNote.trim()} onClick={() => reviewClaim(claim.id, 'reject', rejectNote)}>Confirm rejection</button>
                        <button type='button' className='secondary-button' onClick={() => setRejectingId('')}>Cancel</button>
                      </div>
                    </div>
                  ) : <div className='button-row compact'>
                    <button type='button' className='primary-button' onClick={() => reviewClaim(claim.id, 'approve')}>Approve</button>
                    <button type='button' className='secondary-button' onClick={() => { setRejectingId(claim.id); setRejectNote(''); }}>Reject</button>
                  </div>)}
                  {claim.status === 'APPROVED' && <button type='button' className='primary-button' onClick={() => reviewClaim(claim.id, 'paid')}>Mark paid</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>No reward claims found.</Empty>}
    </section>
  );
}

function AdminReferralsPage({ onError }) {
  const [result, setResult] = useState({ items: [], pagination: { page: 1, pages: 0, total: 0 } });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState('');
  const [members, setMembers] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      try {
        const data = await api(`/admin/referrals?${params}`);
        if (active) setResult(data);
      } catch (cause) {
        if (active) onError(cause.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [search, status, from, to, page, onError]);

  const toggleNetwork = async (userId) => {
    if (expandedId === userId) {
      setExpandedId('');
      return;
    }
    setExpandedId(userId);
    if (members[userId]) return;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      const data = await api(`/admin/referrals/${userId}/members?${params}`);
      setMembers((current) => ({ ...current, [userId]: data }));
    } catch (cause) {
      onError(cause.message);
    }
  };

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'><div><p className='eyebrow'>REFERRAL NETWORK</p><h3>Admin referrals</h3></div></div>
      <div className='admin-table-filters'>
        <label className='field'><span>Search referrer</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder='Name, phone, or referral code' /></label>
        <label className='field'><span>Account status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value=''>All statuses</option><option value='ACTIVE'>Active</option><option value='SUSPENDED'>Suspended</option></select></label>
        <label className='field'><span>From</span><input type='date' value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className='field'><span>To</span><input type='date' value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
      </div>
      {result.items?.length ? <div className='table-wrap'>
        <table>
          <thead><tr><th>Referrer</th><th>Referral code</th><th>Status</th><th>Network users</th><th>Active</th><th>Levels A / B / C</th><th>Qualifying recharge</th><th>Commission A / B / C</th><th>Total commission</th><th>Network</th></tr></thead>
          <tbody>{result.items.map((item) => <Fragment key={item.id}>
            <tr>
              <td>{item.fullName}<small>{item.phoneNumber}</small></td><td>{item.referralCode}</td><td><StatusBadge status={item.status} /></td>
              <td>{item.totalReferrals}</td><td>{item.activeReferrals}</td>
              <td>{item.levelAReferrals} / {item.levelBReferrals} / {item.levelCReferrals}</td>
              <td>{money(item.qualifyingRechargeTotal)}</td>
              <td>{money(item.levelACommission)} / {money(item.levelBCommission)} / {money(item.levelCCommission)}</td>
              <td>{money(item.commissionTotal)}</td><td><button type='button' className='secondary-button' onClick={() => toggleNetwork(item.id)}>{expandedId === item.id ? 'Hide' : 'View'} network</button></td>
            </tr>
            {expandedId === item.id && <tr><td colSpan='10'>{members[item.id] ? members[item.id].length ? <div className='table-wrap'>
              <table><thead><tr><th>Level</th><th>Member</th><th>Sponsor</th><th>Status</th><th>Qualifying recharge</th><th>Approved transactions</th><th>Commission earned</th></tr></thead>
                <tbody>{members[item.id].map((member) => <tr key={member.id}>
                  <td>{member.level}</td><td>{member.fullName}<small>{member.phoneNumber}</small></td><td>{member.sponsorName}</td><td><StatusBadge status={member.status} /></td>
                  <td>{money(member.qualifyingRechargeTotal)}</td>
                  <td>{member.qualifyingRechargeCount ? <details><summary>{member.qualifyingRechargeCount} transaction(s)</summary><div className='form-stack'>{member.qualifyingRecharges.map((recharge) => <small key={recharge.id}>{money(recharge.amount)} · {recharge.transactionReference} · {new Date(recharge.creditedAt).toLocaleDateString()}</small>)}</div></details> : '—'}</td>
                  <td>{money(member.commissionTotal)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <Empty>No network members match this date range.</Empty> : <p role='status'>Loading network…</p>}</td></tr>}
          </Fragment>)}</tbody>
        </table>
      </div> : loading ? <p className='empty-state' role='status'>Loading referral networks…</p> : <Empty>No referral networks found.</Empty>}
      <AdminTablePagination pagination={result.pagination} page={page} setPage={setPage} loading={loading} noun='referrers' />
    </section>
  );
}

function AdminTableFilters({ search, onSearch, status, onStatus, statuses, limit, onLimit, placeholder }) {
  return (
    <div className='admin-table-filters'>
      <label className='field'><span>Search</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} /></label>
      <label className='field'><span>Status</span><select value={status} onChange={(event) => onStatus(event.target.value)}><option value=''>All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className='field'><span>Rows per page</span><select value={limit} onChange={(event) => onLimit(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
    </div>
  );
}

function AdminTablePagination({ pagination, page, setPage, loading, noun = 'requests' }) {
  return (
    <div className='surface-heading admin-table-pagination'>
      <span>{pagination.total ?? 0} {noun} · Page {page} of {Math.max(pagination.pages ?? 0, 1)}</span>
      <div className='button-row compact'>
        <button type='button' className='secondary-button' disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
        <button type='button' className='secondary-button' disabled={page >= (pagination.pages ?? 0) || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status ?? '').toLowerCase().replaceAll('_', '-');
  return <span className={`status-badge status-${normalized}`}>{String(status ?? 'UNKNOWN').replaceAll('_', ' ')}</span>;
}

function AdminSupportPage({ support, onSave }) {
  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>SUPPORT</p>
      <h3>Support configuration</h3>
      <form className='form-stack' onSubmit={onSave}>
        <label className='field checkbox-field'><input type='checkbox' name='supportEnabled' defaultChecked={Boolean(support.supportEnabled)} /><span>Enable support page</span></label>
        <div className='profile-form-grid'>
          <label className='field'><span>Support name</span><input name='supportName' defaultValue={support.supportName ?? ''} /></label>
          <label className='field'><span>Support phone</span><input name='supportPhone' defaultValue={support.supportPhone ?? ''} /></label>
        </div>
        <label className='field'><span>Support message</span><textarea name='supportMessage' rows='3' defaultValue={support.supportMessage ?? ''} /></label>
        <label className='field'><span>Customer support URL</span><input name='customerSupportUrl' defaultValue={support.customerSupportUrl ?? ''} /></label>
        <div className='profile-form-grid'>
          <label className='field'><span>Customer support label</span><input name='customerSupportLabel' defaultValue={support.customerSupportLabel ?? 'Customer Support'} /></label>
          <label className='field checkbox-field'><input type='checkbox' name='customerSupportEnabled' defaultChecked={Boolean(support.customerSupportEnabled)} /><span>Enable customer support link</span></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>WhatsApp number</span><input name='whatsappNumber' defaultValue={support.whatsappNumber ?? ''} /></label>
          <label className='field'><span>WhatsApp URL</span><input name='whatsappUrl' defaultValue={support.whatsappUrl ?? ''} /></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>WhatsApp message</span><input name='whatsappMessage' defaultValue={support.whatsappMessage ?? ''} /></label>
          <label className='field checkbox-field'><input type='checkbox' name='whatsappEnabled' defaultChecked={Boolean(support.whatsappEnabled)} /><span>Enable WhatsApp button</span></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>Official group URL</span><input name='officialGroupUrl' defaultValue={support.officialGroupUrl ?? ''} /></label>
          <label className='field'><span>Official group label</span><input name='officialGroupLabel' defaultValue={support.officialGroupLabel ?? 'Official Group'} /></label>
        </div>
        <label className='field checkbox-field'><input type='checkbox' name='officialGroupEnabled' defaultChecked={Boolean(support.officialGroupEnabled)} /><span>Enable official group link</span></label>
        <label className='field'><span>App download URL</span><input name='appDownloadUrl' defaultValue={support.appDownloadUrl ?? ''} placeholder='https://example.com/app' /></label>
        <button className='primary-button' type='submit'>Save support settings<span>↗</span></button>
      </form>
    </section>
  );
}

function AdminAboutPage({ support, onSave }) {
  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>PUBLIC WEBSITE</p>
      <h3>Configure About page</h3>
      <p className='form-subtitle'>Changes are shown immediately on the public About page.</p>
      <form className='form-stack' onSubmit={onSave}>
        <label className='field'><span>Page heading</span><input name='aboutTitle' defaultValue={support.aboutTitle ?? ''} maxLength='160' required /></label>
        <label className='field'><span>Introduction</span><textarea name='aboutIntro' rows='4' defaultValue={support.aboutIntro ?? ''} maxLength='2000' required /></label>
        <div className='profile-form-grid'>
          <label className='field'><span>First section heading</span><input name='aboutFirstHeading' defaultValue={support.aboutFirstHeading ?? ''} maxLength='120' required /></label>
          <label className='field'><span>Second section heading</span><input name='aboutSecondHeading' defaultValue={support.aboutSecondHeading ?? ''} maxLength='120' required /></label>
        </div>
        <div className='profile-form-grid'>
          <label className='field'><span>First section content</span><textarea name='aboutFirstContent' rows='5' defaultValue={support.aboutFirstContent ?? ''} maxLength='2000' required /></label>
          <label className='field'><span>Second section content</span><textarea name='aboutSecondContent' rows='5' defaultValue={support.aboutSecondContent ?? ''} maxLength='2000' required /></label>
        </div>
        <button className='primary-button' type='submit'>Save About page<span>↗</span></button>
      </form>
    </section>
  );
}

function AdminWelcomePage({ support, onSave, onUploadImage, onError }) {
  const [imageUrl, setImageUrl] = useState(support.welcomeImageUrl ?? '');
  const [imageUploading, setImageUploading] = useState(false);
  const handleImageUpload = async (file) => {
    if (!file) return;
    setImageUploading(true);
    onError('');
    try {
      const uploaded = await onUploadImage(file);
      setImageUrl(uploaded.imageUrl);
    } catch (cause) {
      onError(cause.message || 'Unable to upload welcome illustration.');
    } finally {
      setImageUploading(false);
    }
  };
  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>MEMBER EXPERIENCE</p>
      <h3>Configure post-login welcome page</h3>
      <p className='form-subtitle'>These changes appear after customer login and registration. The welcome bonus value remains connected to the existing registration bonus setting.</p>
      <form className='form-stack' onSubmit={onSave}>
        <div className='profile-form-grid'>
          <label className='field'><span>Eyebrow</span><input name='welcomeEyebrow' defaultValue={support.welcomeEyebrow ?? ''} maxLength='120' required /></label>
          <label className='field'><span>Page title</span><input name='welcomeTitle' defaultValue={support.welcomeTitle ?? ''} maxLength='160' required /></label>
        </div>
        <label className='field'><span>Introduction</span><textarea name='welcomeIntro' rows='3' defaultValue={support.welcomeIntro ?? ''} maxLength='1000' required /></label>
        <div className='profile-form-grid'>
          <label className='field'><span>Welcome bonus label</span><input name='welcomeBonusLabel' defaultValue={support.welcomeBonusLabel ?? ''} maxLength='80' required /></label>
          <label className='field'><span>Home button label</span><input name='welcomeHomeButtonLabel' defaultValue={support.welcomeHomeButtonLabel ?? ''} maxLength='80' required /></label>
        </div>
        <label className='field'><span>Example section title</span><input name='welcomeExampleTitle' defaultValue={support.welcomeExampleTitle ?? ''} maxLength='120' required /></label>
        <div className='profile-form-grid'>
          <label className='field'><span>Example product price (ETB)</span><input type='number' name='welcomeExamplePrice' min='0' max='100000000' step='0.01' defaultValue={support.welcomeExamplePrice ?? 300} required /></label>
          <label className='field'><span>Example daily earnings (ETB)</span><input type='number' name='welcomeExampleDailyEarnings' min='0' max='100000000' step='0.01' defaultValue={support.welcomeExampleDailyEarnings ?? 72} required /></label>
        </div>
        <label className='field'><span>Example disclaimer</span><textarea name='welcomeDisclaimer' rows='3' defaultValue={support.welcomeDisclaimer ?? ''} maxLength='1000' required /></label>
        <label className='field'><span>Illustration image URL (optional)</span><input type='text' name='welcomeImageUrl' value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength='500' placeholder='https://example.com/welcome-image.jpg' />
          <span className='image-upload-control'><input type='file' accept='image/jpeg,image/png,image/webp' disabled={imageUploading} onChange={(event) => { handleImageUpload(event.target.files?.[0]); event.target.value = ''; }} /><small>{imageUploading ? 'Uploading image…' : 'Or choose a JPG, PNG, or WEBP image (up to 5 MB). Save the page to apply it.'}</small></span>
          {imageUrl && <img className='admin-product-image-preview' src={assetUrl(imageUrl)} alt={support.welcomeImageAlt || 'Welcome page illustration preview'} />}
        </label>
        <label className='field'><span>Illustration image description</span><input name='welcomeImageAlt' defaultValue={support.welcomeImageAlt ?? ''} maxLength='200' required /></label>
        <button className='primary-button' type='submit' disabled={imageUploading}>{imageUploading ? 'Uploading image…' : 'Save welcome page'}<span>↗</span></button>
      </form>
    </section>
  );
}

function AdminPublicLinksPage() {
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/settings/links').then((payload) => {
      setLinks(payload?.items ?? []);
    }).catch((cause) => setError(cause.message));
  }, []);

  const updateLink = (index, field, value) => {
    setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const addLink = () => {
    setLinks((current) => [
      ...current,
      { name: '', url: '', description: '', enabled: true, displayOrder: current.length + 1, target: '_blank' },
    ]);
  };

  const removeLink = (index) => {
    setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveLinks = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const normalized = links.map((link, index) => {
        const trimmedUrl = String(link.url ?? '').trim();
        const candidate = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error(`Invalid URL for ${link.name || `link ${index + 1}`}.`);
        }
        return {
          ...link,
          name: String(link.name ?? '').trim(),
          url: url.toString(),
          description: String(link.description ?? '').trim(),
          enabled: Boolean(link.enabled),
          displayOrder: Number(link.displayOrder ?? index + 1),
          target: link.target === '_self' ? '_self' : '_blank',
        };
      });

      const payload = { publicLinks: normalized.filter((link) => link.name && link.url) };
      const result = await api('/admin/settings/links', { method: 'PUT', ...jsonBody(payload) });
      setLinks(result?.items ?? payload.publicLinks);
      setNotice('Public links saved successfully.');
    } catch (cause) {
      setError(cause.message || 'Unable to save public links.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>PUBLIC LINKS</p>
      <h3>Manage public links</h3>
      <p className='form-subtitle'>These links are loaded from the backend and can be changed without code deployment.</p>
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}
      <form className='form-stack' onSubmit={saveLinks}>
        {links.length ? links.map((link, index) => (
          <div key={`${link.name || 'link'}-${index}`} className='surface nested-surface form-stack'>
            <div className='profile-form-grid'>
              <label className='field'><span>Name</span><input value={link.name ?? ''} onChange={(event) => updateLink(index, 'name', event.target.value)} /></label>
              <label className='field'><span>URL</span><input value={link.url ?? ''} onChange={(event) => updateLink(index, 'url', event.target.value)} /></label>
            </div>
            <label className='field'><span>Description</span><textarea rows='2' value={link.description ?? ''} onChange={(event) => updateLink(index, 'description', event.target.value)} /></label>
            <div className='profile-form-grid'>
              <label className='field'><span>Display order</span><input type='number' min='0' value={link.displayOrder ?? index + 1} onChange={(event) => updateLink(index, 'displayOrder', Number(event.target.value))} /></label>
              <label className='field'><span>Target</span>
                <select value={link.target ?? '_blank'} onChange={(event) => updateLink(index, 'target', event.target.value)}>
                  <option value='_blank'>New tab</option>
                  <option value='_self'>Same tab</option>
                </select>
              </label>
            </div>
            <label className='field checkbox-field'><input type='checkbox' checked={Boolean(link.enabled)} onChange={(event) => updateLink(index, 'enabled', event.target.checked)} /><span>Enabled</span></label>
            <button type='button' className='secondary-button' onClick={() => removeLink(index)}>Remove link</button>
          </div>
        )) : <p className='empty-state'>No public links stored yet.</p>}
        <div className='button-row'>
          <button type='button' className='secondary-button' onClick={addLink}>Add link</button>
          <button type='submit' className='primary-button' disabled={busy}>{busy ? 'Saving…' : 'Save links'}<span>↗</span></button>
        </div>
      </form>
    </section>
  );
}

function AdminLoginScreen({ auth, setAuth, onSubmit, busy, error, onDismissError }) {
  return (
    <main className='auth-page'>
      <section className='auth-intro'>
        <a className='brand auth-brand' href='/admin/login'>
          <span className='brand-mark'>A</span>
          <span>MKM Admin<span className='brand-caption'>ADMIN PANEL</span></span>
        </a>
        <div className='intro-copy'>
          <p className='eyebrow'>PRIVATE ACCESS</p>
          <h1>Admin portal</h1>
          <p>Secure administrative controls for customers, payouts, products and support.</p>
        </div>
      </section>
      <section className='auth-side'>
        <div className='auth-form-wrap'>
          <p className='eyebrow'>SIGN IN</p>
          <h2>Administrator login</h2>
          {error && <ErrorToast message={error} onDismiss={onDismissError} />}
          <form onSubmit={onSubmit} className='form-stack'>
            <label className='field'><span>Phone number</span><input type='tel' value={auth.phoneNumber} onChange={(event) => setAuth({ ...auth, phoneNumber: event.target.value })} required /></label>
            <label className='field'><span>Password</span><input type='password' value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} required /></label>
            <button className='primary-button' disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}<span>↗</span></button>
          </form>
        </div>
      </section>
    </main>
  );
}

function ProtectedCustomerApp({ user, dashboard, support, products, team, members, referralInfo, referralsLoading, referralsError, setReferralsError, methods, accounts, recharges, withdrawals, settings, busy, notice, customerSuccessAlert, onDismissCustomerAlert, error, setError, setNotice, onCopyReferral, onPurchase, onSubmitRecharge, onSubmitWithdrawal, onCustomerSuccess, onSaveAccount, onSignOut, onRefreshDashboard }) {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentPath = location.pathname || '/dashboard';
  useEffect(() => {
    setNavOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);
  const currentTitle = (() => {
    if (currentPath.startsWith('/products/')) return 'Product details';
    if (currentPath === '/welcome') return 'Welcome to MKM';
    if (currentPath === '/dashboard') return 'Overview';
    if (currentPath === '/products') return 'Products';
    if (currentPath === '/tasks') return 'Daily Tasks';
    if (currentPath === '/purchases') return 'Purchase history';
    if (currentPath === '/recharge') return 'Recharge';
    if (currentPath === '/recharge/payment') return 'Payment details';
    if (currentPath === '/recharge/history') return 'Recharge history';
    if (currentPath === '/withdrawal-account') return 'Withdrawal Account';
    if (currentPath === '/withdraw') return 'Withdraw';
    if (currentPath === '/withdraw/history') return 'Withdrawal history';
    if (currentPath === '/referrals') return 'Referrals';
    if (currentPath === '/rewards') return 'Rewards';
    if (currentPath === '/transactions') return 'Transactions';
    if (currentPath === '/notifications') return 'Notifications';
    if (currentPath === '/profile') return 'Profile';
    if (currentPath === '/support') return 'Support';
    return 'Member portal';
  })();

  const renderPage = () => {
    if (currentPath === '/welcome') {
      return <WelcomePromotionPage registrationBonus={settings?.registrationBonus ?? 70} support={support} />;
    }
    if (currentPath.startsWith('/products/')) {
      const productId = currentPath.split('/').filter(Boolean).at(-1);
      const item = products.find((product) => product.id === productId) ?? null;
      return <ProductDetailPage product={item} onPurchase={onPurchase} busy={busy} />;
    }
    switch (currentPath) {
      case '/dashboard':
      case '/':
        return <Overview data={dashboard} support={support} onCopy={onCopyReferral} />;
      case '/products':
        return <Products items={products} busy={busy} onPurchase={onPurchase} />;
      case '/tasks':
        return <TasksPage onCustomerSuccess={onCustomerSuccess} onRefreshDashboard={onRefreshDashboard} />;
      case '/purchases':
        return <PurchasesPage />;
      case '/recharge':
        return <Recharge methods={methods} history={recharges} busy={busy} onSubmit={onSubmitRecharge} settings={settings} />;
      case '/recharge/payment':
        return <RechargePaymentPage methods={methods} settings={settings} onCustomerSuccess={onCustomerSuccess} />;
      case '/recharge/history':
        return <RechargeHistoryPage />;
      case '/withdrawal-account':
        return <WithdrawalAccountPage accounts={accounts} methods={methods} support={support} busy={busy} onSaveAccount={onSaveAccount} />;
      case '/withdraw':
        return <Withdraw accounts={accounts} history={withdrawals} balance={dashboard?.wallet?.availableBalance} settings={settings} busy={busy} onSubmit={onSubmitWithdrawal} />;
      case '/withdraw/history':
        return <WithdrawHistoryPage />;
      case '/referrals':
        return <Team summary={team} members={members} loading={referralsLoading} error={referralsError} onDismissError={() => setReferralsError('')} code={dashboard?.referralCode ?? referralInfo?.referralCode} referralLink={referralInfo?.referralLink ?? (dashboard?.referralCode ? `${window.location.origin}/register?ref=${dashboard.referralCode}` : '')} rates={referralInfo?.rates ?? { A: 22, B: 2, C: 1 }} onCopyCode={onCopyReferral} onCopyLink={() => {
          const value = referralInfo?.referralLink ?? (dashboard?.referralCode ? `${window.location.origin}/register?ref=${dashboard.referralCode}` : '');
          navigator.clipboard?.writeText(value).catch(() => undefined);
          setNotice('Referral link copied.');
        }} onShare={async () => {
          const value = referralInfo?.referralLink ?? (dashboard?.referralCode ? `${window.location.origin}/register?ref=${dashboard.referralCode}` : '');
          if (navigator.share && value) {
            try {
              await navigator.share({ title: 'MKM Referral', text: 'Join me on MKM and earn together.', url: value });
              return;
            } catch {
              // fall through to copied link fallback
            }
          }
          if (value) {
            await navigator.clipboard?.writeText(value).catch(() => undefined);
          }
          setNotice('Referral link is ready to share.');
        }} />;
      case '/rewards':
        return <RewardsPage onCustomerSuccess={onCustomerSuccess} />;
      case '/transactions':
        return <TransactionsPage />;
      case '/notifications':
        return <NotificationsPage />;
      case '/profile':
        return <ProfilePage />;
      case '/support':
        return <SupportPage />;
      default:
        return <Navigate to='/dashboard' replace />;
    }
  };

  return (
    <div className='workspace'>
      {user?.role === 'CUSTOMER' && customerSuccessAlert && (
        <div className='customer-success-toast' role='status' aria-live='polite'>
          <CheckCircle2 size={22} aria-hidden='true' />
          <span>{customerSuccessAlert}</span>
          <button type='button' onClick={onDismissCustomerAlert} aria-label='Dismiss success message'><X size={18} /></button>
        </div>
      )}
      <aside className='sidebar customer-sidebar'>
        <div className='sidebar-heading'>
          <NavLink to='/dashboard' className='brand' end>
            <span className='brand-mark'>M</span>
            <span>MKM</span>
          </NavLink>
          <button className='workspace-menu-toggle' type='button' aria-expanded={navOpen} aria-controls='customer-navigation' aria-label={navOpen ? 'Close member navigation' : 'Open member navigation'} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <p className='nav-label'>WORKSPACE</p>
        <nav id='customer-navigation' className={navOpen ? 'is-open' : ''} aria-label='Member navigation'>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end={to === '/dashboard'}>
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className='sidebar-bottom'>
          <span className='avatar'>{user?.fullName?.slice(0, 1).toUpperCase()}</span>
          <div className='user-chip'>
            <strong>{user?.fullName}</strong>
          </div>
          <button className='sign-out-button' type='button' onClick={onSignOut}><LogOut size={16} /> Log out</button>
        </div>
      </aside>
      <main className='main-area'>
        <header className='topbar'>
          <div>
            <p className='eyebrow'>MEMBER ACCOUNT</p>
            <h1>{currentTitle}</h1>
          </div>
          <div className='topbar-right'><span className='status-dot' /> Account active</div>
        </header>
        <div className='content'>
          {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
          {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}
          {renderPage()}
        </div>
      </main>
      <nav className='customer-mobile-footer' aria-label='Mobile member navigation'>
        {mobileMenuOpen && (
          <div className='customer-mobile-menu'>
            <div className='customer-mobile-menu-heading'>
              <strong>All member pages</strong>
              <button type='button' className='customer-mobile-menu-close' onClick={() => setMobileMenuOpen(false)} aria-label='Close all pages menu'><X size={18} /></button>
            </div>
            <div className='customer-mobile-menu-grid'>
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `customer-mobile-menu-link ${isActive ? 'active' : ''}`} end={to === '/dashboard'}>
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
        <div className='customer-mobile-dock'>
          {navItems.filter(({ to }) => ['/dashboard', '/products', '/recharge', '/withdraw'].includes(to)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `customer-mobile-dock-link ${isActive ? 'active' : ''}`} end={to === '/dashboard'}>
              <Icon size={19} strokeWidth={1.9} />
              <span>{label === 'Overview' ? 'Home' : label}</span>
            </NavLink>
          ))}
          <button type='button' className={`customer-mobile-dock-link ${mobileMenuOpen ? 'active' : ''}`} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
            {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
            <span>{mobileMenuOpen ? 'Close' : 'More'}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function AuthScreen({ auth, setAuth, mode, onSubmit, onSwitchMode, busy, error, onDismissError }) {
  const registering = mode === 'register';

  return (
    <main className='auth-page'>
      <section className='auth-intro'>
        <Link className='brand auth-brand' to='/'>
          <span className='brand-mark'>M</span>
          <span>MKM<span className='brand-caption'>MEMBER PORTAL</span></span>
        </Link>
        <div className='intro-copy'>
          <p className='eyebrow'>A CLEARER WAY FORWARD</p>
          <h1>Build your next<br />step with MKM.</h1>
          <p>Manage your wallet, explore products and keep your team in view.</p>
        </div>
        <div className='intro-foot'>SECURE MEMBER ACCESS <span>•</span> MKM {new Date().getFullYear()}</div>
      </section>
      <section className='auth-side'>
        <div className='auth-form-wrap'>
          <p className='eyebrow'>{registering ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'}</p>
          <h2>{registering ? 'Join MKM' : 'Sign in'}</h2>
          <p className='form-subtitle'>{registering ? 'Your account starts here with a 70 ETB welcome bonus.' : 'Sign in with your Ethiopian phone number and password.'}</p>
          {error && <ErrorToast message={error} onDismiss={onDismissError} />}
          <form onSubmit={onSubmit} className='form-stack'>
            {registering && (
              <label className='field'>
                <span>Full Name *</span>
                <input
                  type='text'
                  value={auth.fullName}
                  onChange={(event) => setAuth({ ...auth, fullName: event.target.value })}
                  placeholder='e.g. Abebe Bikila'
                  autoComplete='name'
                  required
                />
              </label>
            )}

            <label className='field'>
              <span>Phone number *</span>
              <div className='phone-input-group'>
                <span className='phone-prefix-pill'>+251</span>
                <input
                  type='tel'
                  inputMode='numeric'
                  placeholder='912345678'
                  value={auth.phoneNumber}
                  onChange={(event) => setAuth({ ...auth, phoneNumber: event.target.value.replace(/\D/g, '').slice(0, 9) })}
                  autoComplete='tel'
                  required
                />
              </div>
              <small>Enter your 9-digit local number (e.g. 912345678 or 712345678).</small>
            </label>

            <label className='field'>
              <span>Login Password *</span>
              <input
                type='password'
                value={auth.password}
                onChange={(event) => setAuth({ ...auth, password: event.target.value })}
                placeholder='Minimum 6 characters'
                autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
            </label>

            {!registering && (
              <div className='auth-forgot-row'>
                <Link to='/forgot-password'>Forgot Password?</Link>
              </div>
            )}

            {registering && (
              <>
                <label className='field'>
                  <span>Confirm Login Password *</span>
                  <input
                    type='password'
                    value={auth.confirmPassword}
                    onChange={(event) => setAuth({ ...auth, confirmPassword: event.target.value })}
                    placeholder='Repeat login password'
                    autoComplete='new-password'
                    minLength={6}
                    required
                  />
                </label>
                <label className='field'>
                  <span>Referral Code (Optional)</span>
                  <input
                    type='text'
                    value={auth.referralCode}
                    onChange={(event) => setAuth({ ...auth, referralCode: event.target.value.toUpperCase() })}
                    placeholder='e.g. MKM-ABC123'
                  />
                  <small>Leave blank if you were not invited by a sponsor.</small>
                </label>
                <label className='terms'>
                  <input
                    type='checkbox'
                    checked={auth.acceptedTerms}
                    onChange={(event) => setAuth({ ...auth, acceptedTerms: event.target.checked })}
                    required
                  />
                  <span>I accept the <Link to='/terms' target='_blank'>Terms of Service</Link> and <Link to='/privacy' target='_blank'>Privacy Policy</Link>.</span>
                </label>
              </>
            )}

            <button className='primary-button large-btn' disabled={busy}>
              {busy ? 'Please wait…' : registering ? 'Create Account (Get 70 ETB Bonus)' : 'Sign In'} <span>↗</span>
            </button>
          </form>
          <p className='auth-switch'>
            {registering ? 'Already a member?' : "Don't have an account?"}{' '}
            <button type='button' onClick={onSwitchMode}>
              {registering ? 'Sign in' : 'Register now'}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function WelcomePromotionPage({ registrationBonus, support }) {
  const navigate = useNavigate();
  return (
    <section className='welcome-promotion'>
      <div className='welcome-promotion-art'>
        <img src={assetUrl(support?.welcomeImageUrl) || welcomePromotionImage} alt={support?.welcomeImageAlt || 'MKM welcome illustration with a rising plant and gift box'} />
      </div>
      <div className='welcome-promotion-copy'>
        <p className='eyebrow'>{support?.welcomeEyebrow || 'YOUR MEMBER JOURNEY STARTS HERE'}</p>
        <h2>{support?.welcomeTitle || 'Welcome to MKM'}</h2>
        <p className='welcome-promotion-intro'>{support?.welcomeIntro || 'We’re glad you’re here. Explore your account, products, and member benefits from one place.'}</p>
        <div className='welcome-promotion-bonus'>
          <span>{support?.welcomeBonusLabel || 'Welcome bonus'}</span>
          <strong>{money(registrationBonus)}</strong>
        </div>
        <div className='welcome-promotion-example'>
          <p className='eyebrow'>{support?.welcomeExampleTitle || 'PRODUCT EXAMPLE'}</p>
          <div className='welcome-example-values'>
            <div><span>Example product price</span><strong>{money(support?.welcomeExamplePrice ?? 300)}</strong></div>
            <div><span>Example daily earnings</span><strong>{money(support?.welcomeExampleDailyEarnings ?? 72)}</strong></div>
          </div>
          <small>{support?.welcomeDisclaimer || 'Illustrative example only. Actual product terms and earnings depend on the product details shown before purchase.'}</small>
        </div>
        <button className='primary-button welcome-home-button' type='button' onClick={() => navigate('/dashboard')}>
          {support?.welcomeHomeButtonLabel || 'Go to Home'} <span>↗</span>
        </button>
      </div>
    </section>
  );
}

function Overview({ data, support, onCopy }) {
  const wallet = data?.wallet;
  const supportDestination = support?.customerSupportEnabled ? (support.customerSupportUrl || support.whatsappUrl || '/support') : '/support';
  const quickActions = [
    { label: 'Recharge', to: '/recharge', icon: ArrowDownToLine },
    { label: 'Withdraw', to: '/withdraw', icon: ArrowUpFromLine },
    { label: 'Products', to: '/products', icon: Package },
    { label: 'Daily Tasks', to: '/tasks', icon: FileText },
    { label: 'Referral', to: '/referrals', icon: Users },
    { label: 'Rewards', to: '/rewards', icon: Gift },
    { label: 'Transactions', to: '/transactions', icon: Wallet },
    { label: 'Notifications', to: '/notifications', icon: Bell },
    { label: 'Withdrawal Account', to: '/withdrawal-account', icon: ShieldCheck },
    { label: 'Profile', to: '/profile', icon: UserCircle },
    { label: support?.customerSupportLabel || 'Customer Support', to: supportDestination, icon: ShieldCheck, external: Boolean(support?.customerSupportEnabled && support?.customerSupportUrl) },
    { label: support?.officialGroupLabel || 'Official Group', to: support?.officialGroupEnabled ? (support.officialGroupUrl || '/support') : '/support', icon: Users, external: Boolean(support?.officialGroupEnabled && support?.officialGroupUrl) },
    { label: 'WhatsApp Support', to: support?.whatsappEnabled ? (support.whatsappUrl || '/support') : '/support', icon: MessageCircle, external: Boolean(support?.whatsappEnabled && support?.whatsappUrl) },
    { label: 'Download App', to: support?.appDownloadUrl || '/support', icon: ArrowDownToLine, external: Boolean(support?.appDownloadUrl) },
  ];

  return (
    <>
      <section className='welcome-row'>
        <div>
          <p className='eyebrow'>YOUR ACCOUNT AT A GLANCE</p>
          <h2>Good to see you.</h2>
          <p>Your MKM activity, all in one place.</p>
        </div>
        <div className='date-stamp'>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </section>
      <div className='metric-grid'>
        <Metric label='Available balance' value={money(wallet?.availableBalance)} tone='green' />
        <Metric label='Pending balance' value={money(wallet?.pendingBalance)} />
        <Metric label='Locked balance' value={money(wallet?.lockedBalance)} />
        <Metric label='Team members' value={data?.team?.total?.userCount ?? '—'} />
      </div>
      <div className='dashboard-quick-actions'>
        {quickActions.map(({ label, to, icon: Icon, external }) => {
          const cardClassName = 'dashboard-action-card';
          if (external) {
            return (
              <a key={label} className={cardClassName} href={to} target='_blank' rel='noreferrer'>
                <Icon size={18} />
                <span>{label}</span>
              </a>
            );
          }

          return (
            <Link key={label} className={cardClassName} to={to}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
      <div className='overview-grid'>
        <section className='surface activity'>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>WALLET</p>
              <h3>Recent transactions</h3>
            </div>
            <span className='quiet-label'>LATEST 5</span>
          </div>
          {data?.recentTransactions?.length ? (
            <div className='transaction-list'>
              {data.recentTransactions.map((item) => (
                <div className='transaction' key={item.id}>
                  <span className={`transaction-icon ${item.direction === 'CREDIT' ? 'credit' : ''}`}>{item.direction === 'CREDIT' ? '+' : '−'}</span>
                  <div className='transaction-name'>
                    <strong>{item.type.replaceAll('_', ' ')}</strong>
                    <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                  </div>
                  <strong className={item.direction === 'CREDIT' ? 'amount-positive' : ''}>{item.direction === 'CREDIT' ? '+' : '−'}{money(item.amount)}</strong>
                </div>
              ))}
            </div>
          ) : <Empty>No wallet activity yet.</Empty>}
        </section>
        <section className='referral-banner'>
          <div className='referral-symbol'><Users size={20} /></div>
          <p className='eyebrow'>GROW YOUR TEAM</p>
          <h3>Your referral link</h3>
          <p>Invite members and follow activity across your A, B and C levels.</p>
          <button className='code-button' onClick={onCopy}>{data?.referralCode ? `${window.location.origin}/register?ref=${encodeURIComponent(data.referralCode)}` : 'Loading…'}<Copy size={15} /></button>
        </section>
      </div>
    </>
  );
}

function Metric({ label, value, tone = '', note = 'ACCOUNT SUMMARY' }) {
  return <section className='metric'><span>{label}</span><strong className={tone}>{value}</strong><small>{note}</small></section>;
}

function Products({ items, busy, onPurchase }) {
  return (
    <>
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>AVAILABLE CATALOG</p>
          <h2>Explore products</h2>
        </div>
        <span className='quiet-label'>{items.length} LISTED</span>
      </div>
      {items.length ? (
        <div className='product-grid'>
          {items.map((product) => {
            const price = Number(product.price ?? 0);
            const rate = Number(product.dailyRate ?? 0.24);
            const normalizedRate = rate > 1 ? rate / 100 : rate;
            const dailyIncome = price * normalizedRate;
            const isComingSoon = product.status === 'COMING_SOON' || (product.availableFrom && new Date(product.availableFrom) > new Date());
            return (
              <article className='product' key={product.id}>
                <img className='customer-product-image' src={getProductImage(product)} alt={`${product.name} product`} loading='lazy' />
                <div className='product-top'>
                  <span className={`product-status ${isComingSoon ? 'coming-soon' : product.status.toLowerCase()}`}>
                    {isComingSoon ? 'COMING SOON' : product.status.replaceAll('_', ' ')}
                  </span>
                  <Package size={18} />
                </div>
                <h3>{product.name}</h3>
                <p>{product.description || 'Daily income product package with guaranteed daily accrual.'}</p>
                <div className='product-details'>
                  <div><small>PRICE</small><strong>{money(product.price)}</strong></div>
                  <div><small>DAILY RETURN ({Math.round(normalizedRate * 100)}%)</small><strong className='highlight-green'>{money(dailyIncome)} / day</strong></div>
                  <div><small>DURATION</small><strong>{product.durationDays} days</strong></div>
                  <div><small>TOTAL REVENUE</small><strong>{money(dailyIncome * product.durationDays)}</strong></div>
                </div>
                {isComingSoon && product.availableFrom && (
                  <div className='scheduled-badge'>
                    Available: {new Date(product.availableFrom).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                <div className='button-row'>
                  <Link className='secondary-button' to={`/products/${product.id}`}>View details</Link>
                  <button className='primary-button' disabled={busy || isComingSoon || product.status !== 'AVAILABLE'} onClick={() => onPurchase(product.id)}>
                    {isComingSoon ? 'Coming soon' : (product.status === 'AVAILABLE' ? 'Purchase product' : 'Not available')}
                    <span>↗</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : <Empty>No products are listed yet.</Empty>}
    </>
  );
}

function ProductDetailPage({ product, onPurchase, busy }) {
  if (!product) return <Empty>Product details are not available yet.</Empty>;

  const price = Number(product.price ?? 0);
  const rate = Number(product.dailyRate ?? 0.24);
  const normalizedRate = rate > 1 ? rate / 100 : rate;
  const dailyIncome = price * normalizedRate;
  const isComingSoon = product.status === 'COMING_SOON' || (product.availableFrom && new Date(product.availableFrom) > new Date());

  return (
    <section className='surface form-surface'>
      <img className='customer-product-detail-image' src={getProductImage(product)} alt={`${product.name} product`} />
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>PRODUCT DETAILS</p>
          <h2>{product.name}</h2>
        </div>
        <span className={`product-status ${isComingSoon ? 'coming-soon' : product.status.toLowerCase()}`}>
          {isComingSoon ? 'COMING SOON' : product.status.replaceAll('_', ' ')}
        </span>
      </div>
      <div className='product-details large'>
        <div><small>PACKAGE PRICE</small><strong>{money(product.price)}</strong></div>
        <div><small>DAILY RETURN ({Math.round(normalizedRate * 100)}%)</small><strong className='highlight-green'>{money(dailyIncome)} / day</strong></div>
        <div><small>DURATION</small><strong>{product.durationDays ?? 30} days</strong></div>
        <div><small>TOTAL ACCRUED RETURN</small><strong>{money(dailyIncome * (product.durationDays ?? 30))}</strong></div>
      </div>
      <p>{product.description || 'Daily income product package with guaranteed daily accrual.'}</p>
      {isComingSoon && product.availableFrom && (
        <div className='scheduled-badge'>
          Available: {new Date(product.availableFrom).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      <div className='button-row'>
        <Link className='secondary-button' to='/products'>← Back to products</Link>
        <button className='primary-button' disabled={busy || isComingSoon || product.status !== 'AVAILABLE'} onClick={() => onPurchase(product.id)}>
          {isComingSoon ? 'Coming soon' : (product.status === 'AVAILABLE' ? 'Purchase product' : 'Not available')}
          <span>↗</span>
        </button>
      </div>
    </section>
  );
}

function PurchasesPage() {
  const [purchases, setPurchases] = useState([]);
  useEffect(() => {
    api('/purchases').then(setPurchases).catch(() => setPurchases([]));
  }, []);
  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>PURCHASES</p>
          <h3>Product purchase history</h3>
        </div>
      </div>
      {purchases.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr><th>Product</th><th>Amount</th><th>Status</th><th>Purchased at</th><th>Activated at</th></tr>
            </thead>
            <tbody>
              {purchases.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{money(item.amount)}</td>
                  <td>{item.status}</td>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                  <td>{item.activatedAt ? new Date(item.activatedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No purchases yet.</Empty>}
    </section>
  );
}

function Team({ summary, members, loading, error, onDismissError, code, referralLink, rates, onCopyCode, onCopyLink, onShare }) {
  const safeRates = rates ?? { A: 22, B: 2, C: 1 };
  const safeMembers = Array.isArray(members) ? members : [];
  const levelCards = [
    { name: 'Level A', rate: safeRates.A ?? 22, value: summary?.aLevel },
    { name: 'Level B', rate: safeRates.B ?? 2, value: summary?.bLevel },
    { name: 'Level C', rate: safeRates.C ?? 1, value: summary?.cLevel },
  ];

  const totalMembers = summary?.total?.userCount ?? 0;
  const activeMembers = summary?.total?.activeUserCount ?? 0;
  const totalEarnings = summary?.total?.totalEarnings ?? '0.00';

  const shareFallback = async () => {
    if (navigator.share && referralLink) {
      try {
        await navigator.share({ title: 'MKM Referral', text: `Join me on MKM: ${referralLink}`, url: referralLink });
        return;
      } catch {
        // The user cancelled the share sheet; fall through to copy fallback.
      }
    }
    await navigator.clipboard?.writeText(referralLink ?? '').catch(() => undefined);
  };
  const whatsappShareUrl = referralLink ? `https://wa.me/?text=${encodeURIComponent(`Join me on MKM: ${referralLink}`)}` : '';

  return (
    <>
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>YOUR NETWORK</p>
          <h2>Share & Earn</h2>
        </div>
        {loading && <p className='quiet-label' role='status'>Loading referral details…</p>}
        {error && <ErrorToast message={error} onDismiss={onDismissError} />}
      </div>

      <section className='surface form-surface referral-share-box'>
        <div className='referral-share-header'>
          <div>
            <p className='eyebrow'>YOUR REFERRAL CODE</p>
            <h3>{code ?? 'Loading…'}</h3>
          </div>
          <button className='secondary-button' onClick={onCopyCode}><Copy size={15} /> Copy code</button>
        </div>

        <div className='referral-link-block'>
          <label className='field'><span>Referral Link</span><input type='text' value={referralLink ?? ''} readOnly /></label>
        </div>

        <div className='button-row'>
          <button type='button' className='secondary-button' onClick={onCopyLink}>Copy link</button>
          {whatsappShareUrl && <a className='secondary-button' href={whatsappShareUrl} target='_blank' rel='noreferrer'>WhatsApp</a>}
          <button type='button' className='primary-button' onClick={onShare ?? shareFallback}>Share</button>
        </div>
      </section>

      <div className='level-grid'>
        <Metric label='Total Referrals' value={totalMembers} note='TEAM MEMBERS' />
        <Metric label='Active Referrals' value={activeMembers} tone={activeMembers > 0 ? 'positive' : ''} note='RECHARGED' />
        <Metric label='Total Earnings' value={money(totalEarnings)} tone='positive' note='COMMISSION' />
      </div>

      <div className='level-grid'>
        {levelCards.map(({ name, rate, value }) => (
          <Metric key={name} label={`${name} · ${rate}%`} value={`${value?.userCount ?? 0} / ${value?.activeUserCount ?? 0}`} note='TOTAL / ACTIVE' />
        ))}
      </div>

      <section className='surface table-surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>MEMBERS</p>
            <h3>Referral history</h3>
          </div>
          <span className='quiet-label'>LEVELS A–C</span>
        </div>
        {safeMembers.length ? (
          <div className='table-wrap'>
            <table>
              <thead>
                <tr><th>Member</th><th>Level</th><th>Status</th><th>Approved recharge</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {safeMembers.map((member) => (
                  <tr key={member.id}>
                    <td><strong>{member.fullName}</strong><small>{member.phoneNumber}</small></td>
                    <td><span className={`level-tag level-${(member.level ?? '').toLowerCase()}`}>{member.level}</span></td>
                    <td>{Number(member.approvedRechargeTotal ?? 0) > 0 ? <span className='status-active'>Active</span> : <span className='status-inactive'>Inactive</span>}</td>
                    <td>{money(member.approvedRechargeTotal)}</td>
                    <td>{member.registeredAt ? new Date(member.registeredAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Your team members will appear here.</Empty>}
      </section>
    </>
  );
}

function Recharge({ methods, history, busy, onSubmit, settings }) {
  const navigate = useNavigate();
  const [customAmount, setCustomAmount] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('1000');
  const [selectedMethodId, setSelectedMethodId] = useState(methods[0]?.id ?? '');
  const [localError, setLocalError] = useState('');
  const minimumRechargeAmount = Number(settings?.minimumRechargeAmount ?? 300);
  const maximumRechargeAmount = Number(settings?.maximumRechargeAmount ?? 1000000);
  const presetAmounts = [300, 600, 1000, 1800, 8000, 20000, 50000, 100000];
  const selectedAmount = Number(customAmount || selectedPreset || 0);

  useEffect(() => {
    if (!selectedMethodId && methods.length) {
      setSelectedMethodId(methods[0].id);
    }
  }, [methods, selectedMethodId]);

  const continueToPayment = () => {
    if (!selectedAmount || selectedAmount < minimumRechargeAmount) {
      setLocalError(`Minimum recharge amount is ${minimumRechargeAmount.toLocaleString()} ETB.`);
      return;
    }
    if (selectedAmount > maximumRechargeAmount) {
      setLocalError(`Maximum recharge amount is ${maximumRechargeAmount.toLocaleString()} ETB.`);
      return;
    }
    if (!selectedMethodId) {
      setLocalError('Please select a payment method.');
      return;
    }
    setLocalError('');
    const method = methods.find((item) => item.id === selectedMethodId);
    navigate('/recharge/payment', { state: { amount: selectedAmount, paymentMethodId: selectedMethodId, method } });
  };

  return (
    <>
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>ADD FUNDS</p>
          <h2>Recharge Wallet</h2>
        </div>
        <button className='secondary-button' type='button' onClick={() => navigate('/recharge/history')}>
          Recharge history
        </button>
      </div>

      <div className='form-layout'>
        <div className='surface form-surface form-stack'>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>STEP 1</p>
              <h3>Select Amount</h3>
            </div>
            <span className='quiet-label'>MIN: {minimumRechargeAmount} ETB</span>
          </div>

          <p className='form-subtitle'>Choose a preset recharge amount or enter your custom amount (300 ETB or higher):</p>
          <div className='preset-amount-grid'>
            {presetAmounts.map((amount) => (
              <button
                key={amount}
                type='button'
                className={`preset-button ${selectedPreset === String(amount) && !customAmount ? 'active' : ''}`}
                onClick={() => { setSelectedPreset(String(amount)); setCustomAmount(''); setLocalError(''); }}
              >
                <strong>{amount.toLocaleString()} ETB</strong>
                <small>{amount >= 8000 ? 'VIP Tier' : 'Standard'}</small>
              </button>
            ))}
          </div>

          <label className='field'>
            <span>Or enter custom amount (ETB)</span>
            <input
              type='number'
              min={minimumRechargeAmount}
              max={maximumRechargeAmount}
              step='0.01'
              value={customAmount}
              onChange={(event) => { setCustomAmount(event.target.value); setSelectedPreset(''); setLocalError(''); }}
              placeholder={`Enter amount (minimum ${minimumRechargeAmount.toLocaleString()} ETB)`}
            />
          </label>

          <div className='selected-summary-bar'>
            <span>Recharge Amount:</span>
            <strong>{selectedAmount ? `${selectedAmount.toLocaleString()} ETB` : '0.00 ETB'}</strong>
          </div>

          <div className='surface-heading' style={{ marginTop: '16px' }}>
            <div>
              <p className='eyebrow'>STEP 2</p>
              <h3>Payment Method</h3>
            </div>
          </div>
          <p className='form-subtitle'>Select the payment method to receive external transfer instructions:</p>

          <div className='payment-method-selector-grid'>
            {methods.filter((method) => method.isActive !== false).map((method) => (
              <button
                type='button'
                key={method.id}
                className={`method-select-card ${selectedMethodId === method.id ? 'active' : ''}`}
                onClick={() => { setSelectedMethodId(method.id); setLocalError(''); }}
              >
                <div className='method-select-icon'>🏦</div>
                <strong>{method.name}</strong>
                <small>{/telebirr/i.test(method.name) ? 'Mobile Money' : 'Bank Transfer'}</small>
              </button>
            ))}
          </div>

          {localError && <ErrorToast message={localError} onDismiss={() => setLocalError('')} />}

          <div className='button-row' style={{ marginTop: '14px' }}>
            <button className='primary-button large-btn' type='button' disabled={busy || !selectedAmount} onClick={continueToPayment}>
              Continue to Payment Details <span>→</span>
            </button>
          </div>
        </div>

        <section className='surface history-surface'>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>RECENT</p>
              <h3>Recent recharges</h3>
            </div>
          </div>
          <History rows={history} />
        </section>
      </div>
    </>
  );
}

function RechargePaymentPage({ methods, settings, onCustomerSuccess }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const selectedMethodId = location.state?.paymentMethodId ?? params.get('methodId') ?? methods[0]?.id ?? '';
  const amount = Number(location.state?.amount ?? params.get('amount') ?? 1000);
  const [selected, setSelected] = useState(methods.find((method) => method.id === selectedMethodId) ?? methods[0] ?? null);
  const [copiedField, setCopiedField] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [showOtherOptions, setShowOtherOptions] = useState(false);

  useEffect(() => {
    setSelected(methods.find((method) => method.id === selectedMethodId) ?? methods[0] ?? null);
  }, [methods, selectedMethodId]);

  if (!selected) return <Empty>No payment methods are available. <Link to='/recharge'>Back to recharge</Link></Empty>;

  const isTelebirr = /telebirr/i.test(selected.name ?? '');
  const accountValue = isTelebirr
    ? (selected.phoneNumber ?? selected.accountNumber ?? '0929688828')
    : (selected.accountNumber ?? selected.phoneNumber ?? '');
  const accountName = selected.accountName || (isTelebirr ? 'Markos' : 'Tesema');
  const copyLabel = isTelebirr ? 'Copy Phone Number' : 'Copy Account Number';

  const copyToClipboard = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(''), 2500);
    }).catch(() => undefined);
  };

  const handleTransactionSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const reference = String(form.get('transactionReference') ?? '').trim();
      if (reference.length < 5) {
        throw new Error('FT / Transaction reference must be at least 5 digits/characters.');
      }
      form.set('amount', String(amount));
      form.set('paymentMethodId', selected.id);

      await api('/recharges', {
        method: 'POST',
        body: form,
      });

      onCustomerSuccess?.('Recharge submitted successfully and is pending review.');
      navigate('/recharge/history');
    } catch (cause) {
      setFormError(cause.message || 'Unable to submit recharge request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='recharge-payment-container'>
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>STEP 2 OF 2</p>
          <h2>Payment Method Details</h2>
        </div>
        <button className='secondary-button' type='button' onClick={() => navigate('/recharge')}>
          ← Change Amount or Method
        </button>
      </div>

      <div className='payment-instruction-box'>
        <div className='payment-card-header'>
          <div>
            <span className='provider-pill'>{selected.name}</span>
            <h3 style={{ margin: '8px 0 4px', fontSize: '22px' }}>{selected.name} Deposit Account</h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
              Please make the external payment first. After payment, submit your transaction information below.
            </p>
          </div>
          <div className='amount-highlight-badge'>
            <small>AMOUNT TO TRANSFER</small>
            <strong>{amount ? `${amount.toLocaleString()} ETB` : '—'}</strong>
          </div>
        </div>

        <div className='payment-credentials-grid'>
          <div className='credential-item'>
            <small>ACCOUNT HOLDER / BENEFICIARY</small>
            <strong>{accountName}</strong>
          </div>

          <div className='credential-item'>
            <small>{isTelebirr ? 'PHONE NUMBER' : 'ACCOUNT NUMBER'}</small>
            <div className='credential-copy-row'>
              <span className='credential-value'>{accountValue || '—'}</span>
              <button
                type='button'
                className='copy-action-btn'
                onClick={() => copyToClipboard(accountValue, 'account')}
              >
                {copiedField === 'account' ? '✓ Copied' : copyLabel}
              </button>
            </div>
          </div>

          <div className='credential-item'>
            <small>TRANSFER AMOUNT</small>
            <div className='credential-copy-row'>
              <span className='credential-value'>{amount ? `${amount.toLocaleString()} ETB` : '—'}</span>
              <button
                type='button'
                className='copy-action-btn'
                onClick={() => copyToClipboard(String(amount), 'amount')}
              >
                {copiedField === 'amount' ? '✓ Copied' : 'Copy Amount'}
              </button>
            </div>
          </div>
        </div>

        {selected.instructions && (
          <div className='payment-note-box'>
            <strong>Instructions:</strong> {selected.instructions}
          </div>
        )}
      </div>

      <section className='surface form-surface form-stack' style={{ marginTop: '24px' }}>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>VERIFICATION</p>
            <h3>Submit Transaction Information</h3>
          </div>
        </div>

        {formError && <ErrorToast message={formError} onDismiss={() => setFormError('')} />}

        <form className='form-stack' onSubmit={handleTransactionSubmit} encType='multipart/form-data'>
          <input type='hidden' name='amount' value={amount} />
          <input type='hidden' name='paymentMethodId' value={selected.id} />

          <label className='field'>
            <span>FT / Transaction Reference * (at least 5 characters)</span>
            <input
              name='transactionReference'
              defaultValue='FT'
              placeholder='FT260901234'
              minLength={5}
              maxLength={120}
              required
            />
            <small>FT is prefilled. Complete it with the exact reference from your SMS or receipt.</small>
          </label>

          <button className='secondary-button' type='button' aria-expanded={showOtherOptions} onClick={() => setShowOtherOptions((open) => !open)}>
            {showOtherOptions ? 'Hide other options' : 'Other options'}
          </button>

          {showOtherOptions && (
            <>
              <label className='field'>
                <span>Sender Full Name (optional)</span>
                <input name='senderName' placeholder='Name on external bank/wallet account' />
              </label>

              <label className='field'>
                <span>Sender Account Number / Phone (optional)</span>
                <input name='senderAccount' placeholder='Your bank account or phone number used' />
              </label>

              <label className='field'>
                <span>Payment Proof Screenshot / Receipt (optional)</span>
                <input name='proof' type='file' accept='image/jpeg,image/png,image/webp,application/pdf' />
                <small>Accepted formats: JPG, JPEG, PNG, WEBP, PDF up to 5 MB. You can also upload it later in Recharge History.</small>
              </label>
            </>
          )}

          <div className='button-row' style={{ marginTop: '12px' }}>
            <button className='primary-button large-btn' type='submit' disabled={submitting}>
              {submitting ? 'Submitting for review…' : 'Submit Recharge Information'} <span>↗</span>
            </button>
            <button className='secondary-button' type='button' onClick={() => navigate('/recharge')}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RechargeHistoryPage() {
  const [items, setItems] = useState([]);
  const [uploadingId, setUploadingId] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const loadHistory = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api('/recharges');
      setItems(data);
    } catch (cause) {
      setLoadError(cause.message || 'Unable to load recharge history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const filteredItems = items.filter((item) => {
    const status = String(item.status).toUpperCase();
    return statusFilter === 'ALL' || (statusFilter === 'PENDING'
      ? ['PENDING', 'UNDER_REVIEW'].includes(status)
      : status === statusFilter);
  });

  const handleUploadProof = async (id, file) => {
    if (!file) return;
    setUploadingId(id);
    setFeedback('');
    setError('');
    try {
      const formData = new FormData();
      formData.append('proof', file);
      await api(`/recharges/${id}/proof`, {
        method: 'POST',
        body: formData,
      });
      setFeedback('Payment proof uploaded successfully!');
      await loadHistory();
    } catch (cause) {
      setError(cause.message || 'Unable to upload payment proof.');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <section className='surface table-surface recharge-history-page'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>RECHARGE HISTORY</p>
          <h3>Submitted recharge transactions</h3>
        </div>
        <Link className='secondary-button' to='/recharge'>+ New Recharge</Link>
      </div>

      {feedback && <SuccessToast message={feedback} onDismiss={() => setFeedback('')} />}
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}

      {loadError ? (
        <div className='history-load-error' role='alert'>
          <span className='history-load-error-icon' aria-hidden='true'>!</span>
          <div>
            <strong>History could not be loaded</strong>
            <p>{loadError}</p>
          </div>
          <button className='secondary-button' type='button' onClick={loadHistory}>Try again</button>
        </div>
      ) : loading ? (
        <div className='history-loading' role='status' aria-live='polite'>
          <span className='history-loading-spinner' aria-hidden='true' />
          <span>Loading your recharge history…</span>
        </div>
      ) : items.length ? (
        <>
          <div className='recharge-history-summary' aria-label='Recharge status summary'>
            <div className='recharge-summary-card'>
              <span>Total requests</span>
              <strong>{items.length}</strong>
              <small>All submitted recharges</small>
            </div>
            <div className='recharge-summary-card'>
              <span>Waiting for review</span>
              <strong>{items.filter((item) => ['PENDING', 'UNDER_REVIEW'].includes(String(item.status).toUpperCase())).length}</strong>
              <small>Being processed by the team</small>
            </div>
            <div className='recharge-summary-card'>
              <span>Approved</span>
              <strong>{items.filter((item) => String(item.status).toUpperCase() === 'APPROVED').length}</strong>
              <small>Added to your wallet</small>
            </div>
          </div>
          <div className='recharge-history-tools'>
            <div className='recharge-history-filters' role='group' aria-label='Filter recharge requests by status'>
              {[
                { value: 'ALL', label: 'All requests' },
                { value: 'PENDING', label: 'In review' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' },
              ].map((filter) => {
                const count = filter.value === 'ALL'
                  ? items.length
                  : items.filter((item) => {
                    const status = String(item.status).toUpperCase();
                    return filter.value === 'PENDING'
                      ? ['PENDING', 'UNDER_REVIEW'].includes(status)
                      : status === filter.value;
                  }).length;

                return (
                  <button
                    key={filter.value}
                    type='button'
                    className={`recharge-filter-chip${statusFilter === filter.value ? ' active' : ''}`}
                    aria-pressed={statusFilter === filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}<span>{count}</span>
                  </button>
                );
              })}
            </div>
            <span className='recharge-results-count'>
              {filteredItems.length} shown
            </span>
          </div>
          {filteredItems.length ? (
            <div className='table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Proof</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const status = String(item.status).toUpperCase();
                    const canUploadProof = ['PENDING', 'UNDER_REVIEW'].includes(status);
                    const hasProof = Boolean(item.proofStorageKey);

                    return (
                      <tr key={item.id}>
                        <td><strong>{money(item.amount)}</strong></td>
                        <td>
                          <span className={`history-status ${status.toLowerCase().replace(/_/g, '-')}`}>
                            {status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td>
                          {hasProof ? (
                            <span className='proof-badge verified'>✓ Proof attached</span>
                          ) : (
                            <span className='proof-badge missing'>Missing proof</span>
                          )}
                          {canUploadProof && (
                            <label className='inline-upload-btn'>
                              <input
                                type='file'
                                accept='image/jpeg,image/png,image/webp,application/pdf'
                                disabled={uploadingId === item.id}
                                onChange={(e) => handleUploadProof(item.id, e.target.files?.[0])}
                                style={{ display: 'none' }}
                              />
                              <span>{uploadingId === item.id ? 'Uploading…' : hasProof ? 'Change proof' : 'Upload proof'}</span>
                            </label>
                          )}
                        </td>
                        <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className='recharge-filter-empty'>
              <span aria-hidden='true'>✓</span>
              <strong>No {statusFilter === 'PENDING' ? 'recharges in review' : statusFilter.toLowerCase() + ' recharges'} right now</strong>
              <p>Choose another filter to see more of your recharge history.</p>
              <button type='button' className='recharge-filter-reset' onClick={() => setStatusFilter('ALL')}>Show all requests</button>
            </div>
          )}
        </>
      ) : <Empty>No recharge requests submitted yet.</Empty>}
    </section>
  );
}

function Withdraw({ accounts, history, balance, settings, busy, onSubmit }) {
  const minimum = Number(settings?.minimumWithdrawalBalance ?? 70);
  const feePercent = Number(settings?.withdrawalFee ?? 10);
  const [amountInput, setAmountInput] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
  const requestedAmount = Number(amountInput);
  const estimatedFee = Number.isFinite(requestedAmount) && requestedAmount > 0
    ? Math.round((requestedAmount * feePercent) + Number.EPSILON) / 100
    : 0;
  const estimatedNet = Number.isFinite(requestedAmount) && requestedAmount > 0
    ? requestedAmount - estimatedFee
    : 0;

  useEffect(() => {
    if (!selectedAccountId && accounts.length) {
      setSelectedAccountId(accounts.find((a) => a.isDefault)?.id ?? accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  return (
    <>
      <div className='section-lead'>
        <div>
          <p className='eyebrow'>PAYOUTS</p>
          <h2>Withdraw funds</h2>
        </div>
        <span className='balance-pill'>Available: {money(balance)}</span>
      </div>

      <div className='form-layout'>
        <div className='form-stack'>
          <form className='surface form-surface form-stack' onSubmit={onSubmit}>
            <h3>Submit Withdrawal Request</h3>

            <div className='withdrawal-info-banner'>
              <div className='info-row'><span>Withdrawal Fee:</span><strong>{feePercent}%</strong></div>
              <div className='info-row'><span>Processing Time:</span><strong>Within 1–8 hours</strong></div>
              <div className='info-row'><span>Frequency Limit:</span><strong>1 withdrawal every 24 hours</strong></div>
              <div className='info-row'><span>Minimum Withdrawal:</span><strong>{money(minimum)}</strong></div>
              {requestedAmount > 0 && (
                <>
                  <div className='info-row'><span>Estimated fee:</span><strong>{money(estimatedFee)}</strong></div>
                  <div className='info-row'><span>You receive:</span><strong>{money(estimatedNet)}</strong></div>
                </>
              )}
            </div>

            {accounts.length ? (
              <div className='field'>
                <span>Select Withdrawal Account</span>
                <div className='account-selection-list'>
                  {accounts.map((account) => (
                    <label key={account.id} className={`account-select-card ${selectedAccountId === account.id ? 'active' : ''}`}>
                      <input
                        type='radio'
                        name='withdrawalAccountId'
                        value={account.id}
                        checked={selectedAccountId === account.id}
                        onChange={() => setSelectedAccountId(account.id)}
                      />
                      <div className='account-card-body'>
                        <div className='account-card-header'>
                          <strong>{account.paymentProvider}</strong>
                          {account.isDefault && <span className='default-badge'>DEFAULT</span>}
                        </div>
                        <div className='account-card-name'>{account.accountHolderName}</div>
                        <div className='account-card-number'>{account.accountNumber}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className='notice-box'>
                <p>You must add a verified withdrawal account before requesting a withdrawal.</p>
                <Link className='primary-button' to='/withdrawal-account'>Set up Withdrawal Account ↗</Link>
              </div>
            )}

            <label className='field'>
              <span>Withdrawal Amount (ETB)</span>
              <input
                name='amount'
                type='number'
                min={minimum}
                max={Number(balance ?? 0)}
                step='0.01'
                placeholder={`Minimum ${minimum} ETB`}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                required
              />
              <small>The fee is deducted from your requested amount. The remaining net amount is sent to your payout account.</small>
            </label>

            <label className='field'>
              <span>Withdrawal Password</span>
              <input
                name='withdrawalPassword'
                type='password'
                autoComplete='current-password'
                placeholder='Enter your 6+ character withdrawal password'
                required
              />
            </label>

            <button className='primary-button large-btn' disabled={busy || !accounts.length}>
              {busy ? 'Processing withdrawal…' : 'Submit Withdrawal Request'} <span>↗</span>
            </button>
          </form>
        </div>

        <section className='surface history-surface'>
          <div className='surface-heading'>
            <div>
              <p className='eyebrow'>RECENT</p>
              <h3>Withdrawal history</h3>
            </div>
          </div>
          <History rows={history} />
        </section>
      </div>
    </>
  );
}

function WithdrawalAccountPage({ accounts, methods, support, busy, onSaveAccount }) {
  const [withdrawalPasswordSet, setWithdrawalPasswordSet] = useState(true);
  const [providerId, setProviderId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [validationHint, setValidationHint] = useState('');

  useEffect(() => {
    api('/profile').then((profile) => setWithdrawalPasswordSet(Boolean(profile.withdrawalPasswordSet))).catch(() => undefined);
  }, []);

  const supportUrl = support?.customerSupportEnabled
    ? (support.customerSupportUrl || support.whatsappUrl || '/support')
    : (support?.whatsappUrl || '/support');

  const selectedProvider = methods.find((method) => method.id === providerId)?.name ?? '';
  const isTelebirr = selectedProvider === 'Telebirr';
  const accountLabel = isTelebirr ? 'Phone Number' : 'Account Number';

  useEffect(() => {
    switch (selectedProvider) {
      case 'Awash Bank':
        setValidationHint('Must be 14 or 15 digits (e.g. 013201013577300)');
        break;
      case 'CBE':
        setValidationHint('Must be exactly 13 digits (e.g. 1000419637649)');
        break;
      case 'Telebirr':
        setValidationHint('Must be exactly 10 digits (e.g. 0929688828)');
        break;
      case 'Abyssinia Bank':
        setValidationHint('Must be 6 to 9 digits (e.g. 221759389)');
        break;
      default:
        setValidationHint('Enter valid digits without spaces or special characters');
    }
  }, [selectedProvider]);

  return (
    <section className='surface form-surface form-stack'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>PAYOUT CONFIGURATION</p>
          <h2>Withdrawal Account</h2>
        </div>
      </div>

      {accounts.length ? (
        <div className='saved-accounts-view'>
          <p className='form-subtitle'>
            Your linked withdrawal destination is saved below. To protect your funds against unauthorized changes, withdrawal accounts are locked once added.
          </p>

          <div className='saved-accounts-grid'>
            {accounts.map((account) => (
              <div className='saved-account-card' key={account.id}>
                <div className='account-badge-row'>
                  <span className='provider-tag'>{account.paymentProvider}</span>
                  <span className='status-pill active'>ACTIVE</span>
                </div>
                <div className='account-holder-name'>{account.accountHolderName}</div>
                <div className='account-number-masked'>{account.accountNumber}</div>
                <div className='account-date'>Added {new Date(account.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>

          <div className='immutable-account-notice'>
            <div className='notice-icon'>🔒</div>
            <div>
              <strong>Need to update or change your bank account?</strong>
              <p>For your security, accounts cannot be edited directly from the app. Please contact official customer support with your verification details.</p>
              <a
                className='secondary-button'
                href={supportUrl}
                target={supportUrl.startsWith('http') ? '_blank' : undefined}
                rel='noreferrer'
              >
                Contact Customer Support to Change Account ↗
              </a>
            </div>
          </div>
        </div>
      ) : (
        <>
          <h3>Add Withdrawal Account</h3>
          <p className='form-subtitle'>
            Link your verified Ethiopian bank or mobile money account. One account may be registered per customer.
          </p>

          <form className='form-stack' onSubmit={onSaveAccount}>
            <label className='field'>
              <span>Payment Provider *</span>
              <select name='paymentMethodId' value={providerId} onChange={(event) => setProviderId(event.target.value)} required>
                <option value='' disabled>Select your bank or mobile provider</option>
                {methods.filter((method) => ['Awash Bank', 'CBE', 'Telebirr', 'Abyssinia Bank'].includes(method.name)).map((method) => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>

            <label className='field'>
              <span>Account Holder Full Name *</span>
              <input
                name='accountHolderName'
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder='Full legal name as shown on bank/telebirr account'
                autoComplete='name'
                required
              />
            </label>

            {!withdrawalPasswordSet && (
              <div className='field-grid'>
                <label className='field'>
                  <span>Create Withdrawal Password * (min 6 chars)</span>
                  <input
                    name='newWithdrawalPassword'
                    type='password'
                    minLength={6}
                    placeholder='Create secure password'
                    autoComplete='new-password'
                    required
                  />
                  <small>Required to authorize future cash payouts.</small>
                </label>
                <label className='field'>
                  <span>Confirm Withdrawal Password *</span>
                  <input
                    name='confirmNewWithdrawalPassword'
                    type='password'
                    minLength={6}
                    placeholder='Repeat withdrawal password'
                    autoComplete='new-password'
                    required
                  />
                </label>
              </div>
            )}

            <label className='field'>
              <span>{accountLabel} *</span>
              <input
                name='accountNumber'
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                inputMode='numeric'
                placeholder={validationHint}
                pattern={selectedProvider === 'Awash Bank' ? '[0-9]{14,15}' : selectedProvider === 'CBE' ? '[0-9]{13}' : selectedProvider === 'Telebirr' ? '[0-9]{10}' : '[0-9]{6,9}'}
                required
              />
              <small className='highlight-hint'>{validationHint}</small>
            </label>

            <div className='button-row' style={{ marginTop: '12px' }}>
              <button className='primary-button large-btn' disabled={busy || !providerId}>
                {busy ? 'Saving account…' : 'Save Withdrawal Account'} <span>↗</span>
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

function WithdrawHistoryPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/withdrawals').then(setItems).catch(() => setItems([])); }, []);
  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>WITHDRAWAL HISTORY</p>
          <h3>Requested payouts</h3>
        </div>
      </div>
      {items.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr><th>Amount</th><th>Status</th><th>Requested</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{money(item.amount)}</td>
                  <td>
                    <span className={`history-status ${String(item.status).toLowerCase().replace(/_/g, '-')}`}>
                      {String(item.status).replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No withdrawals yet.</Empty>}
    </section>
  );
}

function TransactionsPage() {
  const [items, setItems] = useState({ items: [], pagination: { total: 0 } });
  useEffect(() => {
    api('/transactions?page=1&limit=25').then(setItems).catch(() => setItems({ items: [], pagination: { total: 0 } }));
  }, []);
  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>TRANSACTIONS</p>
          <h3>All wallet activity</h3>
        </div>
      </div>
      {items.items?.length ? (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              {items.items.map((item) => <tr key={item.id}><td>{item.type}</td><td>{money(item.amount)}</td><td>{item.status}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : <Empty>No transactions yet.</Empty>}
    </section>
  );
}

function NotificationsPage() {
  const [items, setItems] = useState({ items: [], pagination: { total: 0 } });
  useEffect(() => {
    api('/notifications?page=1&limit=25').then(setItems).catch(() => setItems({ items: [], pagination: { total: 0 } }));
  }, []);

  async function markRead(id) {
    await api(`/notifications/${id}/read`, { method: 'PATCH' });
    setItems((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, isRead: true } : item),
    }));
  }

  return (
    <section className='surface table-surface'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>NOTIFICATIONS</p>
          <h3>Recent messages</h3>
        </div>
      </div>
      {items.items.length ? (
        <div className='history-list'>
          {items.items.map((item) => (
            <div className='history-row' key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>{item.message}</small>
              </div>
              <div>
                <span className={`history-status ${item.isRead ? 'completed' : 'pending'}`}>{item.isRead ? 'Read' : 'Unread'}</span>
                {!item.isRead && <button type='button' className='secondary-button small' onClick={() => markRead(item.id)}>Mark read</button>}
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>You have no notifications yet.</Empty>}
    </section>
  );
}

function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([api('/profile'), api('/withdrawal-accounts')]).then(([result, savedAccounts]) => {
      setProfile(result);
      setFullName(result.fullName ?? '');
      setAccounts(savedAccounts);
    }).catch(() => {
      setProfile(null);
      setAccounts([]);
    });
  }, []);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const trimmed = fullName.trim();
      if (trimmed.length < 2) {
        throw new Error('Full name must be at least 2 characters long.');
      }

      const updated = await api('/profile', {
        method: 'PATCH',
        ...jsonBody({ fullName: trimmed }),
      });
      setProfile(updated);
      setFullName(updated.fullName ?? '');
      setNotice('Profile updated successfully.');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>PROFILE</p>
      <h2>Account details</h2>
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      {notice && <SuccessToast message={notice} onDismiss={() => setNotice('')} />}
      {profile ? (
        <>
          <form className='form-stack' onSubmit={saveProfile}>
            <div className='profile-form-grid'>
              <label className='field'>
                <span>Full Name</span>
                <input type='text' value={fullName} onChange={(event) => setFullName(event.target.value)} required />
              </label>
              <label className='field'>
                <span>Phone</span>
                <input type='tel' value={profile.phoneNumber ?? ''} disabled />
              </label>
            </div>
            <div className='profile-form-grid'>
              <label className='field'>
                <span>Referral Code</span>
                <input type='text' value={profile.referralCode ?? ''} disabled />
              </label>
              <label className='field'>
                <span>Referral Link</span>
                <input type='text' value={profile.referralLink ?? (profile.referralCode ? `${window.location.origin}/register?ref=${profile.referralCode}` : '')} disabled />
              </label>
            </div>
            <div className='profile-form-grid'>
              <label className='field'>
                <span>Sponsor / Referrer</span>
                <input type='text' value={profile.sponsorName ?? 'Not available'} disabled />
              </label>
              <label className='field'>
                <span>Account Status</span>
                <input type='text' value={profile.status ?? 'ACTIVE'} disabled />
              </label>
            </div>
            <div className='profile-form-grid'>
              <label className='field'>
                <span>Registration Date</span>
                <input type='text' value={profile.registeredAt ? new Date(profile.registeredAt).toLocaleDateString() : '—'} disabled />
              </label>
              <div className='field'>
                <span>Profile Actions</span>
                <button className='primary-button' type='submit' disabled={busy}>{busy ? 'Saving…' : 'Save changes'}<span>↗</span></button>
              </div>
            </div>
          </form>

          <h3>Withdrawal accounts</h3>
          {accounts.length ? (
            <div className='history-list'>
              {accounts.map((item) => (
                <div className='history-row' key={item.id}>
                  <div>
                    <strong>{item.accountHolderName}</strong>
                    <small>{item.accountNumber}</small>
                  </div>
                  <span className='history-status completed'>{item.paymentProvider}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No withdrawal accounts saved yet.</Empty>}
        </>
      ) : <Empty>Profile information is unavailable.</Empty>}
    </section>
  );
}

function formatUnlockTime(eligibleAt) {
  if (!eligibleAt) return 'Upcoming';
  const diffMs = new Date(eligibleAt) - new Date();
  if (diffMs <= 0) return 'Ready';
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `In ${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `In ${hours}h ${minutes}m`;
  }
  return `In ${minutes}m`;
}

function TasksPage({ onCustomerSuccess, onRefreshDashboard }) {
  const [tasks, setTasks] = useState({ items: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [pageError, setPageError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('ALL');
  const [sortOrder, setSortOrder] = useState('asc');

  const refresh = async () => {
    setLoading(true);
    setPageError('');
    try {
      setTasks(await api('/tasks'));
    } catch (cause) {
      setPageError(cause.message || 'Failed to load daily tasks.');
      setTasks({ items: [], summary: {} });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const claim = async (taskId) => {
    setBusyId(taskId);
    setPageError('');
    try {
      const result = await api(`/tasks/${taskId}/claim`, { method: 'POST', ...jsonBody({}) });
      const amountMsg = result?.amount ? ` (${money(result.amount)})` : '';
      onCustomerSuccess?.(`Daily reward${amountMsg} claimed successfully!`);
      await Promise.allSettled([refresh(), onRefreshDashboard?.()]);
    } catch (cause) {
      setPageError(cause.message || 'Unable to claim daily reward.');
      await refresh();
    } finally {
      setBusyId('');
    }
  };

  // Group tasks by purchased product / purchase so each VIP displays its 30 days individually
  const productGroups = useMemo(() => {
    const map = new Map();
    for (const item of (tasks.items || [])) {
      const key = item.productPurchaseId || item.productName || 'vip';
      if (!map.has(key)) {
        map.set(key, {
          key,
          purchaseId: item.productPurchaseId,
          productName: item.productName || 'VIP Product',
          items: [],
        });
      }
      map.get(key).items.push(item);
    }
    const list = Array.from(map.values());
    for (const group of list) {
      group.items.sort((a, b) => {
        const tA = new Date(a.businessDate).getTime();
        const tB = new Date(b.businessDate).getTime();
        return sortOrder === 'asc' ? tA - tB : tB - tA;
      });
      group.completedCount = group.items.filter((it) => it.status === 'COMPLETED').length;
      group.totalDays = group.items.length;
      group.dailyEarnings = group.items[0]?.calculatedAmount ?? '0.00';
    }
    return list;
  }, [tasks.items, sortOrder]);

  const activeGroups = selectedProduct === 'ALL'
    ? productGroups
    : productGroups.filter((g) => g.productName === selectedProduct || g.key === selectedProduct);

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <section className='surface table-surface'>
        <div className='surface-heading'>
          <div>
            <p className='eyebrow'>DAILY TASKS</p>
            <h3>VIP Activity Progress</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {tasks.summary?.completedCount > 0 && (
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#059669' }}>
                ✓ {tasks.summary.completedCount} completed of {tasks.items?.length || tasks.summary.totalTasks} total
              </p>
            )}
            <button
              type='button'
              className='secondary-button'
              style={{ padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700 }}
              onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              title='Toggle chronological sort order'
            >
              {sortOrder === 'asc' ? 'Order: Day 1 → 30' : 'Order: Day 30 → 1'}
            </button>
          </div>
        </div>

        {productGroups.length > 1 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '4px 0 0' }}>
            <button
              type='button'
              className={selectedProduct === 'ALL' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '6px 14px', fontSize: '0.85rem', fontWeight: 700 }}
              onClick={() => setSelectedProduct('ALL')}
            >
              All VIPs ({productGroups.length})
            </button>
            {productGroups.map((group) => (
              <button
                key={group.key}
                type='button'
                className={selectedProduct === group.key || selectedProduct === group.productName ? 'primary-button' : 'secondary-button'}
                style={{ padding: '6px 14px', fontSize: '0.85rem', fontWeight: 700 }}
                onClick={() => setSelectedProduct(group.key)}
              >
                {group.productName} ({group.totalDays} Days)
              </button>
            ))}
          </div>
        )}

        {pageError && <ErrorToast message={pageError} onDismiss={() => setPageError('')} />}
      </section>

      {loading ? (
        <section className='surface table-surface'><p className='empty-state' role='status'>Loading tasks…</p></section>
      ) : activeGroups.length ? (
        activeGroups.map((group) => (
          <section key={group.key} className='surface table-surface'>
            <div className='surface-heading' style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <p className='eyebrow' style={{ color: '#059669', fontWeight: 700 }}>INDIVIDUAL VIP PLAN</p>
                <h3 style={{ margin: 0 }}>{group.productName} — 30 Days Tasks</h3>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#111827' }}>
                  Daily Reward: {money(group.dailyEarnings)}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#4b5563', fontWeight: 600 }}>
                  {group.completedCount} of {group.totalDays} claimed
                </p>
              </div>
            </div>

            <div className='table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Business date</th>
                    <th>Base amount</th>
                    <th>Daily earnings</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, index) => {
                    const dayNumber = sortOrder === 'asc' ? index + 1 : group.items.length - index;
                    const eligible = item.eligibleAt ? new Date(item.eligibleAt) <= new Date() : false;
                    const canClaim = item.status === 'WAITING' && eligible;
                    return (
                      <tr key={item.id}>
                        <td>
                          <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: '#f3f4f6', fontWeight: 700, fontSize: '0.8rem', color: '#1f2937' }}>
                            Day {dayNumber}
                          </span>
                        </td>
                        <td><strong>{new Date(item.businessDate).toLocaleDateString()}</strong></td>
                        <td>{money(item.baseAmount)}</td>
                        <td><strong>{money(item.calculatedAmount)}</strong></td>
                        <td><StatusBadge status={item.status} /></td>
                        <td>
                          {canClaim ? (
                            <button
                              type='button'
                              className='primary-button'
                              style={{ padding: '6px 18px', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.02em' }}
                              disabled={Boolean(busyId)}
                              onClick={() => claim(item.id)}
                            >
                              {busyId === item.id ? 'Claiming…' : 'Claim'}
                            </button>
                          ) : item.status === 'COMPLETED' ? (
                            <strong style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.85rem' }}>✓ Claimed</strong>
                          ) : item.status === 'WAITING' ? (
                            <strong
                              style={{ fontSize: '0.85rem', fontWeight: 700, color: '#111827', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                              title={`Unlocks at ${new Date(item.eligibleAt).toLocaleString()}`}
                            >
                              🔒 {formatUnlockTime(item.eligibleAt)}
                            </strong>
                          ) : item.status === 'NOT_ELIGIBLE' ? (
                            <strong style={{ fontSize: '0.85rem', fontWeight: 700, color: '#9ca3af' }}>Expired</strong>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <section className='surface table-surface'><Empty>No daily tasks yet.</Empty></section>
      )}
    </div>
  );
}

function RewardsPage({ onCustomerSuccess }) {
  const [rewards, setRewards] = useState({ items: [], summary: {} });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setError('');
    setLoading(true);
    try {
      setRewards(await api('/rewards'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, []);
  const claim = async (reward) => {
    setBusyId(reward.id);
    setError('');
    try {
      await api(`/rewards/${reward.id}/claim`, { method: 'POST', ...jsonBody({}) });
      await refresh();
      onCustomerSuccess?.('Reward claim submitted. It is waiting for admin approval.');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className='surface customer-rewards'>
      <div className='surface-heading'>
        <div>
          <p className='eyebrow'>REWARDS</p>
          <h3>Deposit milestone rewards</h3>
        </div>
      </div>
      <p className='customer-rewards-intro'>Only approved deposits count toward your milestones. Submitted claims remain pending until an administrator reviews them.</p>
      {error && <ErrorToast message={error} onDismiss={() => setError('')} />}
      <div className='metric-grid customer-reward-summary'>
        <Metric label='Approved qualifying deposits' value={money(rewards.items?.[0]?.qualifyingDeposits ?? 0)} />
        <Metric label='Available to claim' value={money(rewards.summary?.totalClaimable ?? 0)} />
        <Metric label='Waiting for approval' value={money(rewards.summary?.totalPending ?? 0)} />
        <Metric label='Paid / approved' value={money(rewards.summary?.totalCompleted ?? 0)} />
      </div>
      {loading ? <p className='empty-state' role='status'>Loading reward milestones…</p> : rewards.items?.length ? (
        <div className='customer-reward-grid'>
          {rewards.items.map((item) => {
            const progress = item.ruleType === 'MILESTONE' && Number(item.thresholdAmount) > 0
              ? Math.min(100, (Number(item.qualifyingDeposits) / Number(item.thresholdAmount)) * 100)
              : 0;
            return (
              <article className='customer-reward-card' key={item.id}>
                <div className='customer-reward-card-heading'>
                  <div><p className='eyebrow'>{item.ruleType === 'MILESTONE' ? 'DEPOSIT MILESTONE' : item.ruleType}</p><h4>{item.name}</h4></div>
                  <span className='customer-reward-amount'>{money(item.rewardAmount)}</span>
                </div>
                {item.ruleType === 'MILESTONE' ? (
                  <div className='customer-reward-progress'>
                    <div className='customer-reward-progress-label'><span>Approved deposits</span><strong>{money(item.qualifyingDeposits)} <small>of {money(item.thresholdAmount)}</small></strong></div>
                    <div className='customer-reward-progress-track' role='progressbar' aria-label={`${item.name} deposit progress`} aria-valuemin='0' aria-valuemax='100' aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
                  </div>
                ) : <p className='customer-reward-unavailable'>This reward type is not currently available to claim.</p>}
                <div className='customer-reward-footer'>
                  <StatusBadge status={item.status} />
                  {item.status === 'CLAIMABLE'
                    ? <button type='button' className='primary-button' disabled={Boolean(busyId)} onClick={() => claim(item)}>{busyId === item.id ? 'Submitting…' : 'Claim reward'}<span>↗</span></button>
                    : <span className='customer-reward-status-copy'>{item.status === 'PENDING' ? 'Waiting for admin approval'
                      : item.status === 'APPROVED' ? 'Approved — awaiting payment'
                        : item.status === 'PAID' ? 'Paid to wallet'
                          : item.status === 'REJECTED' ? 'Claim rejected'
                            : item.ruleType === 'MILESTONE' ? 'Deposit threshold not reached' : 'Not available for claim'}</span>}
                </div>
              </article>
            );
          })}
        </div>
      ) : <Empty>No reward milestones are configured yet.</Empty>}
    </section>
  );
}

function SupportPage() {
  const [support, setSupport] = useState(null);
  useEffect(() => { api('/support').then(setSupport).catch(() => setSupport(null)); }, []);
  return (
    <section className='surface form-surface form-stack'>
      <p className='eyebrow'>CUSTOMER SUPPORT</p>
      <h2>Reach the MKM team</h2>
      {support ? (
        <>
          <div className='product-details'>
            <div><small>SUPPORT NAME</small><strong>{support.supportName}</strong></div>
            <div><small>PHONE</small><strong>{support.supportPhone}</strong></div>
            <div><small>OFFICIAL GROUP</small><strong>{support.officialGroupName}</strong></div>
          </div>
          <p>{support.supportMessage}</p>
          {support.whatsappEnabled !== false && support.whatsappUrl && <a className='primary-button' href={support.whatsappUrl} target='_blank' rel='noreferrer'><MessageCircle size={16} /> {support.whatsappMessage ? 'Chat on WhatsApp' : 'Contact us on WhatsApp'}</a>}
          {support.officialGroupEnabled !== false && support.officialGroupUrl && <a className='secondary-button' href={support.officialGroupUrl} target='_blank' rel='noreferrer'>{support.officialGroupLabel ?? 'Join Official Group'}</a>}
          {support.customerSupportEnabled !== false && support.customerSupportUrl && <a className='secondary-button' href={support.customerSupportUrl} target='_blank' rel='noreferrer'>{support.customerSupportLabel ?? 'Customer Support'}</a>}
          {support.publicLinks?.length ? (
            <div className='product-details'>
              {support.publicLinks.filter((link) => link.enabled !== false).map((link) => (
                <div key={`${link.name}-${link.url}`}>
                  <small>{String(link.name).toUpperCase()}</small>
                  <strong><a href={link.url} target={link.target ?? '_blank'} rel='noreferrer'>{link.name}</a></strong>
                  {link.description ? <p>{link.description}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : <Empty>Support information is currently unavailable.</Empty>}
    </section>
  );
}

function History({ rows }) {
  return rows.length ? (
    <div className='history-list'>
      {rows.map((row) => (
        <div className='history-row' key={row.id}>
          <div>
            <strong>{money(row.amount)}</strong>
            <small>{row.paymentMethod ?? row.transactionReference ?? new Date(row.createdAt).toLocaleDateString()}</small>
          </div>
          <span className={`history-status ${String(row.status).toLowerCase()}`}>{String(row.status).replaceAll('_', ' ')}</span>
        </div>
      ))}
    </div>
  ) : <Empty>No requests yet.</Empty>;
}

function Empty({ children }) {
  return <p className='empty-state'>{children}</p>;
}
