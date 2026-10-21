import React, { useState, useEffect } from 'react';
import { 
  Shield, KeyRound, Users, DollarSign, Terminal, LogOut, PlusCircle, Trash2, 
  CheckCircle2, Clock, AlertTriangle, RefreshCw, Copy, Check, 
  Settings, Lock, Unlock, Cpu, Activity, Zap, Search, Smartphone, Globe, X, Download, ShieldCheck, CheckSquare, Square
} from 'lucide-react';

interface KeyItem {
  id: number;
  key_value: string;
  duration_days: number;
  max_devices: number;
  hwid_list: string[];
  hwid?: string;
  is_disabled?: number;
  created_at: string;
  created_by: string;
  reseller_id?: number;
  activated_at?: string;
  expires_at?: string;
  note?: string;
  product_id?: string;
  product_name?: string;
  price_at_issue?: number | null;
  issuer_role?: 'admin' | 'reseller';
  issuer_username?: string;
}

interface Reseller {
  id: number;
  username: string;
  balance: number;
  is_active: number;
  created_at: string;
  note?: string;
}

interface Product { id: string; name: string; }
interface PriceItem { product_id?: string; duration_days: number; price: number; }

interface BalanceLog {
  id: number;
  reseller_id: number;
  amount: number;
  reason: string;
  created_at: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('sc_token'));
  const [role, setRole] = useState<'admin' | 'reseller' | null>(localStorage.getItem('sc_role') as any);
  const [username, setUsername] = useState<string>(localStorage.getItem('sc_username') || '');

  // Login form state
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  // Admin Data
  const [adminData, setAdminData] = useState<{
    keys: KeyItem[];
    resellers: Reseller[];
    prices: PriceItem[];
    stats: { total: number; used: number; unused: number; totalDevices: number };
    api_url: string;
  } | null>(null);

  // Reseller Data
  const [resellerData, setResellerData] = useState<{
    reseller: Reseller;
    keys: KeyItem[];
    prices: PriceItem[];
    products?: Product[];
    logs: BalanceLog[];
  } | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'generate' | 'resellers' | 'pricing' | 'api'>('overview');

  // Key Selection for Bulk Actions
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([]);
  const [keyProductFilter, setKeyProductFilter] = useState('all');

  // Key Generation Form
  const [genProduct, setGenProduct] = useState('samurai-engine');
  const [genDuration, setGenDuration] = useState(7);
  const [genCount, setGenCount] = useState(10);
  const [genMaxDevices, setGenMaxDevices] = useState(1);
  const [genNote, setGenNote] = useState('');

  // Generated Keys Popup Modal State
  const [generatedModalKeys, setGeneratedModalKeys] = useState<string[] | null>(null);
  
  // Reseller Create Form
  const [newResellerUser, setNewResellerUser] = useState('');
  const [newResellerPass, setNewResellerPass] = useState('');
  const [newResellerBalance, setNewResellerBalance] = useState(100);
  const [newResellerNote, setNewResellerNote] = useState('');

  // Prices state editor
  const [pricesEdit, setPricesEdit] = useState<Record<string, number>>({});
  const [pricingProduct, setPricingProduct] = useState('samurai-engine');
  const [products, setProducts] = useState<Product[]>([{id:'samurai-engine',name:'Samurai Engine'},{id:'aim-cheto',name:'AIM CHETO'}]);
  const [newPriceDays, setNewPriceDays] = useState('');

  const productName = (id: string) => products.find(p => p.id === id)?.name || id;
  const pricesFor = (prices: PriceItem[], productId: string) => prices.filter(p => (p.product_id || 'samurai-engine') === productId).sort((a, b) => a.duration_days - b.duration_days);
  const adminProductPrices = adminData ? pricesFor(adminData.prices, genProduct) : [];
  const visibleAdminKeys = adminData ? adminData.keys.filter(k => keyProductFilter === 'all' || (k.product_id || 'samurai-engine') === keyProductFilter) : [];
  const selectedVisibleKeyIds = selectedKeyIds.filter(id => visibleAdminKeys.some(k => k.id === id));
  const adminGenerationReady = adminProductPrices.some(p => p.duration_days === genDuration);

  // Reseller generator
  const [resGenProduct, setResGenProduct] = useState('samurai-engine');
  const [resGenDuration, setResGenDuration] = useState(1);
  const [resGenCount, setResGenCount] = useState(5);
  const [resGenMaxDevices, setResGenMaxDevices] = useState(1);
  const resellerProductPrices = resellerData ? pricesFor(resellerData.prices, resGenProduct) : [];
  const generationPrice = resellerProductPrices.find(p => p.duration_days === resGenDuration)?.price;
  const resellerGenerationReady = generationPrice !== undefined;

  // API Tester state
  const [testKey, setTestKey] = useState('');
  const [testHwid, setTestHwid] = useState('DEVICE-PHONE-9988');
  const [testResult, setTestResult] = useState<any>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Copied to clipboard!`);
  };

  const fetchData = async () => {
    if (!token) return;
    try {
      const res = await fetch(role === 'admin' ? '/api/admin/data' : '/api/reseller/data', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        if (role === 'admin') {
          setAdminData(data);
          if (Array.isArray(data.products) && data.products.length) setProducts(data.products);
          const pMap: Record<string, number> = {};
          data.prices.forEach((p: PriceItem) => pMap[`${p.product_id || 'samurai-engine'}:${p.duration_days}`] = p.price);
          setPricesEdit(pMap);
        } else {
          if (Array.isArray(data.products) && data.products.length) setProducts(data.products);
          setResellerData(data);
        }
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (adminProductPrices.length && !adminProductPrices.some(p => p.duration_days === genDuration)) setGenDuration(adminProductPrices[0].duration_days);
  }, [genProduct, adminData?.prices]);

  useEffect(() => {
    if (resellerProductPrices.length && !resellerProductPrices.some(p => p.duration_days === resGenDuration)) setResGenDuration(resellerProductPrices[0].duration_days);
  }, [resGenProduct, resellerData?.prices]);

  useEffect(() => {
    setSelectedKeyIds(ids => ids.filter(id => visibleAdminKeys.some(k => k.id === id)));
  }, [keyProductFilter, adminData?.keys]);

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token, role]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('sc_token', data.token);
        localStorage.setItem('sc_role', data.role);
        localStorage.setItem('sc_username', data.username);
        setToken(data.token);
        setRole(data.role);
        setUsername(data.username);
        showToast(`Welcome back, ${data.username}!`);
      } else {
        setLoginError(data.message || 'Login failed');
      }
    } catch (err) {
      setLoginError('Connection error during login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('sc_token');
    localStorage.removeItem('sc_role');
    localStorage.removeItem('sc_username');
    setToken(null);
    setRole(null);
    setUsername('');
    setAdminData(null);
    setResellerData(null);
    showToast('Logged out successfully');
  };

  // Admin Generate Keys
  const adminGenerateKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminGenerationReady) { showToast('Configure a price for this product and duration first'); return; }
    try {
      const res = await fetch('/api/admin/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ product_id: genProduct, duration: genDuration, count: genCount, max_devices: genMaxDevices, note: genNote })
      });
      const data = await res.json();
      if (data.success) {
        const freshRes = await fetch('/api/admin/data', { headers: { 'Authorization': `Bearer ${token}` } });
        const freshData = await freshRes.json();
        if (freshData.success) {
          const newKeys = freshData.keys.slice(0, genCount).map((k: KeyItem) => k.key_value);
          setGeneratedModalKeys(newKeys);
          setAdminData(freshData);
        }
        showToast(data.message);
        setGenNote('');
      } else {
        showToast(data.message || 'Failed to generate');
      }
    } catch (err) {
      showToast('Network error');
    }
  };

  const savePrices = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ product_id: pricingProduct, prices: Object.fromEntries(Object.entries(pricesEdit).filter(([k]) => k.startsWith(`${pricingProduct}:`)).map(([k,v]) => [k.split(':')[1], Math.max(0, Number(v.toFixed ? v.toFixed(2) : v))])) })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Prices updated successfully');
        fetchData();
      } else {
        showToast(data.message);
      }
    } catch (err) {
      showToast('Error saving prices');
    }
  };

  const createReseller = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/reseller/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ username: newResellerUser, password: newResellerPass, balance: newResellerBalance, note: newResellerNote })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Reseller created successfully');
        setNewResellerUser('');
        setNewResellerPass('');
        setNewResellerNote('');
        fetchData();
      } else {
        showToast(data.message || 'Failed to create reseller');
      }
    } catch (err) {
      showToast('Error creating reseller');
    }
  };

  const updateResellerBalance = async (resellerId: number, amount: number, reason: string) => {
    try {
      const res = await fetch('/api/admin/reseller/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ reseller_id: resellerId, amount, reason })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Balance updated');
        fetchData();
      } else {
        showToast(data.message);
      }
    } catch (err) {
      showToast('Error updating balance');
    }
  };

  const toggleReseller = async (resellerId: number) => {
    try {
      const res = await fetch(`/api/admin/reseller/toggle/${resellerId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Reseller status toggled');
        fetchData();
      }
    } catch (err) {
      showToast('Error toggling status');
    }
  };

  // Foolproof POST delete
  const deleteKey = async (keyId: number) => {
    if (!confirm('Are you sure you want to delete this license key?')) return;
    try {
      const res = await fetch(`/api/admin/key/delete/${keyId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Key deleted successfully');
        fetchData();
      } else {
        showToast(data.message || 'Failed to delete key');
      }
    } catch (err) {
      showToast('Error deleting key');
    }
  };

  const resetKeyDevices = async (keyId: number) => {
    if (!confirm('Reset all device HWID bindings for this key?')) return;
    try {
      const res = await fetch(`/api/admin/key/reset-devices/${keyId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Device bindings reset successfully');
        fetchData();
      }
    } catch (err) {
      showToast('Error resetting devices');
    }
  };

  const toggleDisableKey = async (keyId: number) => {
    try {
      const res = await fetch(`/api/admin/key/toggle-disable/${keyId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Key status updated');
        fetchData();
      }
    } catch (err) {
      showToast('Error toggling key status');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedKeyIds.length === 0) return;
    if (!confirm(`Delete ${selectedKeyIds.length} selected keys?`)) return;
    try {
      const res = await fetch('/api/admin/keys/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedKeyIds })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        setSelectedKeyIds([]);
        fetchData();
      }
    } catch (err) {
      showToast('Batch delete failed');
    }
  };

  const handleBatchReset = async () => {
    if (selectedKeyIds.length === 0) return;
    if (!confirm(`Reset devices for ${selectedKeyIds.length} selected keys?`)) return;
    try {
      const res = await fetch('/api/admin/keys/batch-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedKeyIds })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        setSelectedKeyIds([]);
        fetchData();
      }
    } catch (err) {
      showToast('Batch reset failed');
    }
  };

  const handleBatchStatus = async (isDisabled: boolean) => {
    if (selectedKeyIds.length === 0) return;
    try {
      const res = await fetch('/api/admin/keys/batch-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedKeyIds, is_disabled: isDisabled ? 1 : 0 })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        setSelectedKeyIds([]);
        fetchData();
      }
    } catch (err) {
      showToast('Batch status update failed');
    }
  };

  const toggleSelectAll = () => {
    if (!adminData || visibleAdminKeys.length === 0) return;
    if (visibleAdminKeys.every(k => selectedKeyIds.includes(k.id))) {
      setSelectedKeyIds(selectedKeyIds.filter(id => !visibleAdminKeys.some(k => k.id === id)));
    } else {
      setSelectedKeyIds(Array.from(new Set([...selectedKeyIds, ...visibleAdminKeys.map(k => k.id)])));
    }
  };

  const toggleSelectKey = (id: number) => {
    if (selectedKeyIds.includes(id)) {
      setSelectedKeyIds(selectedKeyIds.filter(i => i !== id));
    } else {
      setSelectedKeyIds([...selectedKeyIds, id]);
    }
  };

  // Reseller Generate Keys
  const resellerGenerateKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resellerGenerationReady) { showToast('This product and duration are not available'); return; }
    if (generationPrice !== undefined && generationPrice * resGenCount > resellerData!.reseller.balance) { showToast('Insufficient balance'); return; }
    try {
      const res = await fetch('/api/reseller/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ product_id: resGenProduct, duration: resGenDuration, count: resGenCount, max_devices: resGenMaxDevices })
      });
      const data = await res.json();
      if (data.success) {
        const freshRes = await fetch('/api/reseller/data', { headers: { 'Authorization': `Bearer ${token}` } });
        const freshData = await freshRes.json();
        if (freshData.success) {
          const newKeys = freshData.keys.slice(0, resGenCount).map((k: KeyItem) => k.key_value);
          setGeneratedModalKeys(newKeys);
          setResellerData(freshData);
        }
        showToast(data.message);
      } else {
        showToast(data.message || 'Failed to generate');
      }
    } catch (err) {
      showToast('Error generating keys');
    }
  };

  // API Tester
  const testApiActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: testKey, hwid: testHwid })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: 'API connection failed' });
    }
  };

  // Login Screen (No preset buttons)
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden select-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="w-full max-w-md bg-slate-900/90 border border-slate-800/80 rounded-3xl shadow-2xl p-8 backdrop-blur-2xl relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-xl shadow-purple-600/30 mb-4">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">SHADOW CRACKER</h1>
            <p className="text-slate-400 text-xs mt-1 font-medium tracking-wide uppercase">Enterprise License Infrastructure</p>
          </div>

          {loginError && (
            <div className="mb-6 p-3.5 bg-red-950/80 border border-red-800/80 text-red-300 text-xs rounded-xl flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Username</label>
              <input 
                type="text" 
                value={loginUser} 
                onChange={e => setLoginUser(e.target.value)} 
                required 
                placeholder="Enter username"
                className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
              <input 
                type="password" 
                value={loginPass} 
                onChange={e => setLoginPass(e.target.value)} 
                required 
                placeholder="••••••••••••••"
                className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition"
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-xl shadow-purple-600/30 transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 mt-2"
            >
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Secure Authentication</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-purple-500 selection:text-white pb-28">
      {/* Top Header Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-xl px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-purple-500/25">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight flex items-center gap-2 text-white">
              <span>SHADOW CRACKER</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase font-mono font-semibold">
                {role}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Operator: <strong className="text-slate-200">{username}</strong> {role === 'reseller' && resellerData && `• Balance: $${resellerData.reseller.balance}`}
            </div>
          </div>
        </div>

        <button 
          onClick={handleLogout}
          className="px-3.5 py-2 bg-red-950/40 hover:bg-red-900/50 border border-red-800/40 text-red-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 mb-6">
        {role === 'admin' && adminData && (
          <div>
            {/* Tab 1: Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl backdrop-blur-md min-h-[160px]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Keys</div>
                      <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shadow-inner">
                        <KeyRound className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-white mt-4 font-mono">{adminData.stats.total}</div>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl backdrop-blur-md min-h-[160px]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Activated Keys</div>
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-emerald-400 mt-4 font-mono">{adminData.stats.used}</div>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl backdrop-blur-md min-h-[160px]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Unused Keys</div>
                      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-inner">
                        <Clock className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-amber-400 mt-4 font-mono">{adminData.stats.unused}</div>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl backdrop-blur-md min-h-[160px]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Registered Devices</div>
                      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
                        <Smartphone className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-cyan-400 mt-4 font-mono">{adminData.stats.totalDevices}</div>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl backdrop-blur-md min-h-[160px]">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Resellers</div>
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
                        <Users className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-indigo-400 mt-4 font-mono">{adminData.resellers.length}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Key Database with Comprehensive Bulk Action Options */}
            {activeTab === 'keys' && (
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl relative">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-purple-400" />
                    <span>License Key Database</span>
                  </h2>

                  <label className="text-xs text-slate-400 flex items-center gap-2">Filter product
                    <select aria-label="Filter keys by product" value={keyProductFilter} onChange={e => setKeyProductFilter(e.target.value)} className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white">
                      <option value="all">All products</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>

                  {/* Comprehensive Bulk Actions Toolbar when keys are selected */}
                  {selectedKeyIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-2 border border-purple-500/40 rounded-2xl shadow-xl animate-in fade-in duration-200">
                      <span className="text-xs text-purple-300 font-semibold px-2">
                        {selectedKeyIds.length} selected:
                      </span>
                      <button 
                        onClick={handleBatchDelete}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shadow-md"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                      <button 
                        onClick={handleBatchReset}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shadow-md"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reset Devices</span>
                      </button>
                      <button 
                        onClick={() => handleBatchStatus(true)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shadow-md"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Disable</span>
                      </button>
                      <button 
                        onClick={() => handleBatchStatus(false)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shadow-md"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Enable</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                        <th className="py-3 px-3 w-10">
                          <button onClick={toggleSelectAll} className="text-white hover:text-purple-400 transition" title="Select All">
                            {adminData.keys.length > 0 && visibleAdminKeys.length > 0 && visibleAdminKeys.every(k => selectedKeyIds.includes(k.id)) ? (
                              <CheckSquare className="w-4 h-4 text-purple-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </th>
                        <th className="py-3 px-3">License Key</th>
                        <th className="py-3 px-3">Product</th><th className="py-3 px-3">Duration</th><th className="py-3 px-3">Price at issue</th><th className="py-3 px-3">Issued by</th>
                        <th className="py-3 px-3">Devices (HWID)</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Actions (Delete / Reset / Disable)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {visibleAdminKeys.map(k => {
                        const isSelected = selectedKeyIds.includes(k.id);
                        return (
                          <tr key={k.id} className={`hover:bg-slate-800/40 transition ${k.is_disabled ? 'opacity-60 bg-red-950/10' : ''}`}>
                            <td className="py-3 px-3 w-10">
                              <button onClick={() => toggleSelectKey(k.id)} className="text-white hover:text-purple-400 transition">
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-purple-400" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-500" />
                                )}
                              </button>
                            </td>
                            <td className="py-3 px-3 text-purple-300 font-bold flex items-center gap-2">
                              <span className="truncate max-w-[150px]">{k.key_value}</span>
                              <button onClick={() => copyToClipboard(k.key_value)} className="text-slate-500 hover:text-white transition" title="Copy Key">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="py-3 px-3 text-cyan-300">{k.product_name || products.find(p => p.id === (k.product_id || 'samurai-engine'))?.name || 'Samurai Engine'}</td><td className="py-3 px-3">{k.duration_days}d</td><td className="py-3 px-3">{typeof k.price_at_issue === 'number' ? `$${k.price_at_issue.toFixed(2)}` : 'Not recorded'}</td><td className="py-3 px-3">{k.issuer_role || (k.reseller_id ? 'reseller' : 'admin')} / {k.issuer_username || k.created_by || 'Unknown'}</td>
                            <td className="py-3 px-3 text-cyan-400 flex items-center gap-1.5">
                              <Smartphone className="w-3.5 h-3.5" />
                              <span>{k.hwid_list?.length || 0} / {k.max_devices}</span>
                            </td>
                            <td className="py-3 px-3 font-sans">
                              {k.is_disabled ? (
                                <span className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[11px] font-medium border border-red-500/25">Disabled</span>
                              ) : !k.activated_at ? (
                                <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-[11px] font-medium border border-amber-500/25">Unused</span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[11px] font-medium border border-emerald-500/25">Active</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Delete Button (Foolproof POST) */}
                                <button 
                                  onClick={() => deleteKey(k.id)}
                                  className="p-2 bg-red-950/50 hover:bg-red-900/70 text-red-400 rounded-xl transition shadow-sm cursor-pointer"
                                  title="Delete Key"
                                >
                                  <Trash2 className="w-4 h-4 pointer-events-none" />
                                </button>
                                {/* Device Reset Button */}
                                <button 
                                  onClick={() => resetKeyDevices(k.id)}
                                  className="p-2 bg-cyan-950/50 hover:bg-cyan-900/70 text-cyan-400 rounded-xl transition shadow-sm cursor-pointer"
                                  title="Reset Device HWID Slots"
                                >
                                  <RefreshCw className="w-4 h-4 pointer-events-none" />
                                </button>
                                {/* Disable / Enable Button */}
                                <button 
                                  onClick={() => toggleDisableKey(k.id)}
                                  className={`p-2 rounded-xl transition shadow-sm cursor-pointer ${k.is_disabled ? 'bg-emerald-950/50 hover:bg-emerald-900/70 text-emerald-400' : 'bg-amber-950/50 hover:bg-amber-900/70 text-amber-400'}`}
                                  title={k.is_disabled ? 'Enable Key' : 'Disable Key'}
                                >
                                  {k.is_disabled ? <Unlock className="w-4 h-4 pointer-events-none" /> : <Lock className="w-4 h-4 pointer-events-none" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {visibleAdminKeys.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-slate-500 font-sans">No keys generated yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 3: Generate Keys */}
            {activeTab === 'generate' && (
              <div className="max-w-xl mx-auto bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2.5">
                  <PlusCircle className="w-5 h-5 text-purple-400" />
                  <span>Generate License Keys</span>
                </h2>
                <form onSubmit={adminGenerateKeys} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Product</label>
                    <select aria-label="Product for admin key generation" value={genProduct} onChange={e => setGenProduct(e.target.value)} className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm">
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Duration (Days)</label>
                    <select aria-label="Duration for admin key generation" value={genDuration} onChange={e => setGenDuration(Number(e.target.value))} disabled={!adminProductPrices.length} className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm disabled:opacity-50">
                      {adminProductPrices.map(p => <option key={p.duration_days} value={p.duration_days}>{p.duration_days} Day{p.duration_days === 1 ? '' : 's'} — ${p.price}</option>)}
                    </select>
                    {!adminProductPrices.length && <p className="text-xs text-amber-400 mt-2">No prices configured for {productName(genProduct)}.</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Key Count</label>
                      <input 
                        type="number" 
                        min={1} 
                        max={200} 
                        value={genCount} 
                        onChange={e => setGenCount(Number(e.target.value))}
                        className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-purple-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Device Limit (HWID)</label>
                      <input 
                        type="number" 
                        min={1} 
                        max={20} 
                        value={genMaxDevices} 
                        onChange={e => setGenMaxDevices(Number(e.target.value))}
                        className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-purple-500 transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Note (Optional)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. VIP Client Giveaway" 
                      value={genNote} 
                      onChange={e => setGenNote(e.target.value)}
                      className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-purple-500 transition"
                    />
                  </div>

                  <button 
                    type="submit"
                    disabled={!adminGenerationReady}
                    className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl shadow-xl shadow-purple-600/30 transition text-sm mt-2"
                  >
                    Generate Keys
                  </button>
                </form>
              </div>
            )}

            {/* Tab 4: Reseller Management */}
            {activeTab === 'resellers' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                  <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-400" />
                    <span>Create Reseller</span>
                  </h2>
                  <form onSubmit={createReseller} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Username</label>
                      <input 
                        type="text" 
                        required 
                        value={newResellerUser} 
                        onChange={e => setNewResellerUser(e.target.value)} 
                        placeholder="reseller_name"
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                      <input 
                        type="text" 
                        required 
                        value={newResellerPass} 
                        onChange={e => setNewResellerPass(e.target.value)} 
                        placeholder="secure_password"
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Initial Balance ($)</label>
                      <input 
                        type="number" 
                        value={newResellerBalance} 
                        onChange={e => setNewResellerBalance(Number(e.target.value))} 
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Note</label>
                      <input 
                        type="text" 
                        value={newResellerNote} 
                        onChange={e => setNewResellerNote(e.target.value)} 
                        placeholder="optional"
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <button type="submit" className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-purple-600/30 transition">
                      Create Reseller
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                  <h2 className="text-base font-bold text-white mb-4">Active Resellers</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                          <th className="py-3 px-3">Username</th>
                          <th className="py-3 px-3">Balance</th>
                          <th className="py-3 px-3">Status</th>
                          <th className="py-3 px-3">Update Balance</th>
                          <th className="py-3 px-3 text-right">Toggle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {adminData.resellers.map(r => (
                          <tr key={r.id} className="hover:bg-slate-800/40 transition">
                            <td className="py-3 px-3 font-semibold text-white">{r.username}</td>
                            <td className="py-3 px-3 text-cyan-400 font-mono font-bold text-sm">${r.balance}</td>
                            <td className="py-3 px-3">
                              {r.is_active ? (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[11px] font-medium border border-emerald-500/20">Active</span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[11px] font-medium border border-red-500/20">Disabled</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <button 
                                onClick={() => {
                                  const amt = prompt(`Enter balance amount to add (+) or subtract (-) for ${r.username}:`, '50');
                                  if (amt) updateResellerBalance(r.id, Number(amt), 'Admin adjustment');
                                }}
                                className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-xl text-xs font-semibold transition"
                              >
                                Modify Bal
                              </button>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button 
                                onClick={() => toggleReseller(r.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${r.is_active ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50 hover:bg-amber-900/60' : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 hover:bg-emerald-900/60'}`}
                              >
                                {r.is_active ? 'Disable' : 'Enable'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Pricing */}
            {activeTab === 'pricing' && (
              <div className="max-w-xl mx-auto bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-purple-400" />
                  <span>Duration Pricing & Cost Configuration</span>
                </h2>
                <p className="text-xs text-slate-400 mb-6">Set the exact balance amount deducted from resellers per key generation for each duration.</p>
                <form onSubmit={savePrices} className="space-y-4">
                  <label className="block text-xs font-semibold text-slate-400 uppercase">Product
                    <select aria-label="Product for pricing" value={pricingProduct} onChange={e => setPricingProduct(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  </label>
                  <div className="flex gap-2 items-end">
                    <label className="flex-1 block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">New duration (days)<input aria-label="New duration in days" type="number" min="1" step="1" value={newPriceDays} onChange={e => setNewPriceDays(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white" placeholder="e.g. 14" /></label>
                    <button type="button" onClick={() => { const d = Number(newPriceDays); if (Number.isInteger(d) && d > 0) { const key = `${pricingProduct}:${d}`; if (Object.prototype.hasOwnProperty.call(pricesEdit, key)) { showToast('That duration already exists'); return; } setPricesEdit({...pricesEdit, [key]: 0}); setNewPriceDays(''); } else showToast('Enter a positive whole number of days'); }} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold">Add row</button>
                  </div>
                  {Object.entries(pricesEdit).filter(([key]) => key.startsWith(`${pricingProduct}:`)).sort(([a], [b]) => Number(a.split(':')[1]) - Number(b.split(':')[1])).map(([key, value]) => {
                    const days = Number(key.split(':')[1]);
                    return <div key={key} className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-sm font-semibold text-slate-300">{days} Day{days > 1 ? 's' : ''} License</span><div className="flex items-center gap-2"><span className="text-xs text-slate-500">$</span><input aria-label={`${productName(pricingProduct)} ${days} day price`} type="number" min="0" step="0.01" value={value} onChange={e => setPricesEdit({...pricesEdit, [key]: Math.max(0, Number(e.target.value))})} className="w-28 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white font-mono text-sm text-right focus:outline-none focus:border-purple-500" /></div>
                    </div>;
                  })}
                  {!Object.keys(pricesEdit).some(key => key.startsWith(`${pricingProduct}:`)) && <p className="text-xs text-amber-400">No prices configured for {productName(pricingProduct)}.</p>}
                  <button type="submit" className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-purple-600/30 transition mt-2">
                    Save Pricing Table
                  </button>
                </form>
              </div>
            )}

            {/* Tab 6: API */}
            {activeTab === 'api' && (
              <div className="space-y-6 max-w-2xl mx-auto">
                <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                  <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-purple-400" />
                    <span>API Activation Simulator</span>
                  </h2>
                  <form onSubmit={testApiActivation} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">License Key</label>
                      <input 
                        type="text" 
                        required 
                        placeholder="SH-XXXX-..." 
                        value={testKey} 
                        onChange={e => setTestKey(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Device HWID</label>
                      <input 
                        type="text" 
                        value={testHwid} 
                        onChange={e => setTestHwid(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-white"
                      />
                    </div>
                    <button type="submit" className="w-full py-3.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-cyan-600/30">
                      Test Activation Request
                    </button>
                  </form>
                  <div className="mt-5 pt-4 border-t border-slate-800 text-xs text-slate-300 space-y-2">
                    <h3 className="font-semibold text-white">API contract</h3>
                    <p><code>POST /api/activate</code> body: <code>{`{ license_key, hwid }`}</code>; success: <code>{`{ success, session_id, expires }`}</code>.</p>
                    <p><code>POST /api/heartbeat</code> body: <code>{`{ license_key, hwid, session_id }`}</code>.</p>
                    <p>Errors use <code>{`{ success: false, message, error_code }`}</code>. No <code>features</code> or <code>session_valid</code> claim is part of the contract.</p>
                  </div>

                  {testResult && (
                    <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs">
                      <pre className={testResult.success ? 'text-emerald-400 overflow-x-auto' : 'text-red-400 overflow-x-auto'}>
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {role === 'reseller' && resellerData && (
          <div>
            {/* Tab 1: Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl min-h-[160px]">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Balance</div>
                    <div className="text-4xl font-extrabold text-cyan-400 mt-4 font-mono">${resellerData.reseller.balance}</div>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 flex flex-col justify-between shadow-2xl min-h-[160px]">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Generated Keys</div>
                    <div className="text-4xl font-extrabold text-purple-400 mt-4 font-mono">{resellerData.keys.length}</div>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                  <h2 className="text-base font-bold text-white mb-3">Key Duration Prices (Set by Admin)</h2>
                  <label className="block text-xs text-slate-400 mb-3">Product<select aria-label="Product for reseller pricing" value={resGenProduct} onChange={e => setResGenProduct(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {resellerProductPrices.map(p => (
                      <div key={`${p.product_id || 'samurai-engine'}:${p.duration_days}`} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-center">
                        <div className="text-xs text-slate-400">{p.duration_days} Day(s)</div>
                        <div className="text-base font-bold text-cyan-400 mt-1 font-mono">${p.price} / key</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Keys */}
            {activeTab === 'keys' && (
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-4">Your Generated Keys</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                        <th className="py-3 px-3">License Key</th>
                        <th className="py-3 px-3">Product</th>
                        <th className="py-3 px-3">Duration</th>
                        <th className="py-3 px-3">Price at issue</th>
                        <th className="py-3 px-3">Issued by</th>
                        <th className="py-3 px-3">Devices (HWID)</th>
                        <th className="py-3 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {resellerData.keys.map(k => (
                        <tr key={k.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-3 text-purple-300 font-bold flex items-center gap-2">
                            <span className="truncate max-w-[160px]">{k.key_value}</span>
                            <button onClick={() => copyToClipboard(k.key_value)} className="text-slate-500 hover:text-white transition">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </td>
                          <td className="py-3 px-3 text-cyan-300">{k.product_name || products.find(p => p.id === (k.product_id || 'samurai-engine'))?.name || 'Samurai Engine'}</td><td className="py-3 px-3">{k.duration_days}d</td><td className="py-3 px-3">{typeof k.price_at_issue === 'number' ? `$${k.price_at_issue.toFixed(2)}` : 'Not recorded'}</td><td className="py-3 px-3">{k.issuer_role || (k.reseller_id ? 'reseller' : 'admin')} / {k.issuer_username || k.created_by || 'Unknown'}</td>
                          <td className="py-3 px-3 text-cyan-400">📱 {k.hwid_list?.length || 0} / {k.max_devices}</td>
                          <td className="py-3 px-3 font-sans">
                            {k.is_disabled ? (
                              <span className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[11px] font-medium border border-red-500/25">Disabled</span>
                            ) : !k.activated_at ? (
                              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-[11px] font-medium border border-amber-500/25">Unused</span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[11px] font-medium border border-emerald-500/25">Active</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 3: Generate */}
            {activeTab === 'generate' && (
              <div className="max-w-xl mx-auto bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <PlusCircle className="w-5 h-5 text-purple-400" />
                  <span>Generate Keys (Balance Deduction)</span>
                </h2>
                <p className="text-xs text-slate-400 mb-6">
                  Current Balance: <strong className="text-cyan-400">${resellerData.reseller.balance}</strong>. Cost is deducted automatically based on admin rates.
                </p>
                <form onSubmit={resellerGenerateKeys} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Product & Duration</label><select aria-label="Product for reseller key generation" value={resGenProduct} onChange={e => setResGenProduct(e.target.value)} className="w-full mb-2 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <select 
                      value={resGenDuration} 
                      onChange={e => setResGenDuration(Number(e.target.value))}
                      className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                    >
                      {resellerProductPrices.map(p => (
                        <option key={p.duration_days} value={p.duration_days}>
                          {p.duration_days} Day(s) — ${p.price} per key
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Count</label>
                      <input 
                        type="number" 
                        min={1} 
                        max={50} 
                        value={resGenCount} 
                        onChange={e => setResGenCount(Number(e.target.value))}
                        className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Device Limit</label>
                      <input 
                        type="number" 
                        min={1} 
                        max={10} 
                        value={resGenMaxDevices} 
                        onChange={e => setResGenMaxDevices(Number(e.target.value))}
                        className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 flex justify-between items-center font-mono">
                    <span>Estimated Total Cost:</span>
                    <span className="text-cyan-400 font-bold text-sm">
                      ${((generationPrice || 0) * resGenCount).toFixed(2)}
                    </span>
                  </div>

                  <button type="submit" disabled={!resellerGenerationReady || (generationPrice || 0) * resGenCount > resellerData.reseller.balance} className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold shadow-xl shadow-purple-600/30 transition">
                    Generate Keys & Deduct Balance
                  </button>
                </form>
              </div>
            )}

            {/* Tab 4: Reseller History */}
            {activeTab === 'resellers' && (
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-4">Balance Transaction History</h2>
                <div className="space-y-3">
                  {resellerData.logs.map(l => (
                    <div key={l.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <div className="text-slate-200 font-medium">{l.reason}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{l.created_at?.substring(0, 16)}</div>
                      </div>
                      <div className={`font-mono font-bold text-sm ${l.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {l.amount > 0 ? `+$${l.amount}` : `-$${Math.abs(l.amount)}`}
                      </div>
                    </div>
                  ))}
                  {resellerData.logs.length === 0 && (
                    <div className="text-center py-10 text-slate-500 text-xs">No transactions yet.</div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 5: Pricing */}
            {activeTab === 'pricing' && (
              <div className="max-w-xl mx-auto bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-4">Key Duration Pricing</h2>
                <label className="block text-xs text-slate-400 mb-3">Product<select aria-label="Product for reseller pricing table" value={resGenProduct} onChange={e => setResGenProduct(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-3">
                  {resellerProductPrices.map(p => (
                    <div key={`${p.product_id || 'samurai-engine'}:${p.duration_days}`} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-center">
                      <div className="text-xs text-slate-400">{p.duration_days} Day(s)</div>
                      <div className="text-lg font-bold text-cyan-400 mt-1 font-mono">${p.price}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 6: API */}
            {activeTab === 'api' && (
              <div className="max-w-xl mx-auto bg-slate-900/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-base font-bold text-white mb-3">API Integration Docs</h2>
                <div className="space-y-3 text-xs text-slate-300"><p><code>POST /api/activate</code> body: <code>{`{ license_key, hwid }`}</code>. Success returns <code>{`{ success, session_id, expires }`}</code>.</p><p><code>POST /api/heartbeat</code> body: <code>{`{ license_key, hwid, session_id }`}</code>.</p><p>Errors return <code>{`{ success: false, message, error_code }`}</code>. Do not rely on undocumented <code>features</code> or <code>session_valid</code> fields.</p></div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Generated Keys Popup Modal */}
      {generatedModalKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-lg bg-slate-900 border border-purple-500/40 rounded-3xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
            <button 
              onClick={() => setGeneratedModalKeys(null)}
              className="absolute top-5 right-5 p-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Generated Keys ({generatedModalKeys.length})</h3>
                <p className="text-xs text-slate-400">Successfully generated and saved to database.</p>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2 p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs">
              {generatedModalKeys.map((k, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-slate-900/80 border border-slate-800/60 rounded-lg">
                  <span className="text-purple-300 font-bold">{k}</span>
                  <button 
                    onClick={() => copyToClipboard(k)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] transition flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button 
                onClick={() => copyToClipboard(generatedModalKeys.join('\n'))}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold text-xs transition shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                <span>Copy All Keys</span>
              </button>
              <button 
                onClick={() => setGeneratedModalKeys(null)}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold text-xs transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800/80 backdrop-blur-2xl z-40 px-2 py-2 flex items-center justify-around shadow-2xl">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'overview' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <Activity className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">Dashboard</span>
        </button>

        <button 
          onClick={() => setActiveTab('keys')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'keys' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <KeyRound className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">Keys</span>
        </button>

        <button 
          onClick={() => setActiveTab('generate')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'generate' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <PlusCircle className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">Generate</span>
        </button>

        <button 
          onClick={() => setActiveTab('resellers')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'resellers' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <Users className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">{role === 'admin' ? 'Resellers' : 'History'}</span>
        </button>

        <button 
          onClick={() => setActiveTab('pricing')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'pricing' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <DollarSign className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">Pricing</span>
        </button>

        <button 
          onClick={() => setActiveTab('api')}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all ${activeTab === 'api' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-500/20 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <Terminal className="w-5 h-5 mb-1" />
          <span className="text-[11px] font-semibold tracking-tight">API</span>
        </button>
      </nav>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-purple-500/50 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-purple-400" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
