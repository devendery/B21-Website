// script.js
// Adds:
// - MetaMask connect + Polygon switch
// - Price widget via CoinGecko (BTC, ETH, MATIC)
// - Airdrop registration helpers (connect, optional sign, POST to webhook)
// - Copy helpers for contract & Polygonscan description
//
// IMPORTANT: Replace AIRDROP_WEBHOOK_URL with your server endpoint to collect addresses/signatures.

const CONTRACT = '0x9e885a4b54a04c8311e8c480f89c0e92cc0a1db2';
const QUICKSWAP_URL = `https://quickswap.exchange/#/swap?outputCurrency=${CONTRACT}`;
const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,polygon&vs_currencies=usd&include_24hr_change=true';
const POLYGON_PARAMS = {
  chainId: '0x89', // 137
  chainName: 'Polygon Mainnet',
  nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls: ['https://polygon-rpc.com/'],
  blockExplorerUrls: ['https://polygonscan.com/']
};

// Set this to your server endpoint that will receive registrations:
// Recommended: POST JSON { address, signature, network, timestamp }
// If blank, registration will store locally (demo).
const AIRDROP_WEBHOOK_URL = ''; // <-- replace with your webhook URL (https://yourserver.example/airdrop)

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const contractEl = document.getElementById('contractAddress');
  const copyBtn = document.getElementById('copyAddress');
  const buyBtn = document.getElementById('buyBtn');
  const connectBtn = document.getElementById('connectWallet');
  const priceIds = { bitcoin: 'p-bitcoin', ethereum: 'p-ethereum', polygon: 'p-polygon' };
  const airdropConnect = document.getElementById('airdropConnect');
  const airdropSign = document.getElementById('airdropSign');
  const airdropRegister = document.getElementById('airdropRegister');
  const airdropStatus = document.getElementById('airdropStatus');
  const registeredAddressesEl = document.getElementById('registeredAddresses');
  const copyPolyscan = document.getElementById('copyPolyscan');
  const polygonscanText = document.getElementById('polygonscanText');

  // populate contract & buy link
  if (contractEl) contractEl.textContent = CONTRACT;
  if (buyBtn) buyBtn.href = QUICKSWAP_URL;

  // Price widget - initial fetch + polling
  async function fetchPrices() {
    try {
      const res = await fetch(COINGECKO_SIMPLE);
      const json = await res.json();
      if (!json) return;
      Object.keys(priceIds).forEach(id => {
        const el = document.getElementById(priceIds[id]);
        if (el && json[id]) {
          const usd = json[id].usd;
          const change = json[id].usd_24h_change;
          el.textContent = `$${usd.toLocaleString(undefined, {maximumFractionDigits: 2})} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`;
          el.style.color = change >= 0 ? '#9ae6b4' : '#f18b9d';
        }
      });
    } catch (err) {
      console.warn('Price fetch error', err);
    }
  }
  fetchPrices();
  setInterval(fetchPrices, 15000); // every 15s

  // Copy helpers
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT);
      showTemp(copyBtn, 'Copied');
    } catch {
      alert('Copy failed — copy manually: ' + CONTRACT);
    }
  });
  if (copyPolyscan && polygonscanText) copyPolyscan.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(polygonscanText.textContent.trim());
      showTemp(copyPolyscan, 'Copied');
    } catch {
      alert('Copy failed — select and copy manually.');
    }
  });

  // Wallet helpers
  async function isMetaMask() {
    return !!window.ethereum && !!window.ethereum.isMetaMask;
  }
  async function connectWallet() {
    if (!window.ethereum) {
      window.open('https://metamask.io/download.html', '_blank');
      throw new Error('No wallet');
    }
    // request accounts
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    return accounts[0];
  }
  async function switchToPolygon() {
    if (!window.ethereum) throw new Error('No wallet');
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: POLYGON_PARAMS.chainId }]
      });
    } catch (switchError) {
      if (switchError && switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [POLYGON_PARAMS]
        });
      } else {
        throw switchError;
      }
    }
  }

  // Connect button (header)
  if (connectBtn) connectBtn.addEventListener('click', async () => {
    try {
      await switchToPolygon();
      const addr = await connectWallet();
      connectBtn.textContent = shortAddr(addr);
      connectBtn.classList.add('connected');
    } catch (err) {
      console.error(err);
      alert('Wallet connect failed: ' + (err.message || err));
    }
  });

  // Airdrop flow: connect -> sign -> register
  let currentAddress = null;
  let currentSignature = null;

  if (airdropConnect) airdropConnect.addEventListener('click', async () => {
    try {
      await switchToPolygon();
      const addr = await connectWallet();
      currentAddress = addr;
      airdropStatus.textContent = `Connected: ${shortAddr(addr)}`;
      updateRegisteredList();
    } catch (err) {
      console.error(err);
      airdropStatus.textContent = 'Connect failed';
      alert('Connect error: ' + (err.message || err));
    }
  });

  if (airdropSign) airdropSign.addEventListener('click', async () => {
    if (!currentAddress) { alert('Please connect wallet first'); return; }
    try {
      const message = `Block21 airdrop proof\nAddress: ${currentAddress}\nTime: ${new Date().toISOString()}\nNonce: ${Math.floor(Math.random()*1e6)}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, currentAddress]
      });
      currentSignature = { message, signature };
      airdropStatus.textContent = 'Signed message (local)';
      showTemp(airdropSign, 'Signed');
    } catch (err) {
      console.error(err);
      alert('Sign failed: ' + (err.message || err));
    }
  });

  if (airdropRegister) airdropRegister.addEventListener('click', async () => {
    if (!currentAddress) { alert('Connect first'); return; }
    // Build payload
    const payload = {
      address: currentAddress,
      chain: 'polygon',
      timestamp: new Date().toISOString(),
      signature: currentSignature ? currentSignature.signature : null,
      message: currentSignature ? currentSignature.message : null,
      source: window.location.href
    };

    try {
      if (AIRDROP_WEBHOOK_URL && AIRDROP_WEBHOOK_URL.length > 8) {
        const res = await fetch(AIRDROP_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Webhook returned ' + res.status);
        airdropStatus.textContent = 'Registered on server';
      } else {
        // fallback: store locally (demo)
        storeLocalRegistration(payload);
        airdropStatus.textContent = 'Registered locally (no webhook configured)';
      }
      updateRegisteredList();
      showTemp(airdropRegister, 'Registered');
    } catch (err) {
      console.error(err);
      alert('Registration failed: ' + (err.message || err));
    }
  });

  // local storage helpers (demo)
  function storeLocalRegistration(payload) {
    const key = 'b21_registrations_v1';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.unshift(payload);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
  }
  function updateRegisteredList() {
    const key = 'b21_registrations_v1';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    registeredAddressesEl.innerHTML = '';
    arr.slice(0,50).forEach(p => {
      const li = document.createElement('li');
      li.textContent = `${shortAddr(p.address)} — ${new Date(p.timestamp).toLocaleString()}`;
      registeredAddressesEl.appendChild(li);
    });
  }
  // initial load of registered list
  updateRegisteredList();

  // small UI helpers
  function shortAddr(addr) {
    if (!addr) return '';
    return addr.slice(0,6) + '…' + addr.slice(-4);
  }
  function showTemp(el, text) {
    const orig = el.textContent;
    el.textContent = text;
    setTimeout(()=> el.textContent = orig, 1400);
  }

  // copy polygonscan description
  if (copyPolyscan && polygonscanText) copyPolyscan.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(polygonscanText.textContent.trim());
      showTemp(copyPolyscan, 'Copied');
    } catch {
      alert('Copy failed — please copy manually.');
    }
  });

  // auto-refresh price on focus
  window.addEventListener('focus', fetchPrices);
});