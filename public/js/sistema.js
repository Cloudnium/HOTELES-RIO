// ============================================================
//  sistema.js — Sistema de Gestión Interna Hoteles Rio
//  Conectado a Supabase
// ============================================================

// ── CONFIGURACIÓN SUPABASE ──────────────────────────────────
// TODO: Reemplaza con tus credenciales de Supabase
const SUPABASE_URL = 'https://jyzteirrmjangptekmgm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5enRlaXJybWphbmdwdGVrbWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMjExNTYsImV4cCI6MjA5MTY5NzE1Nn0.Qc85njSX6BE15i3w8WN2SJ8t1vYzAzPDrP_9FRkQQCk';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── ESTADO GLOBAL ───────────────────────────────────────────
let currentUser = null;
let currentUserProfile = null;
let cajaActual = null;
let carritoPublico = {}; // { productoId: cantidad }

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setDateBadge();
  setupLoginForm();
  setupNavigation();
  setupModals();

  // Verificar sesión activa
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await handleLogin(session.user);
  }

  // Escuchar cambios de sesión
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await handleLogin(session.user);
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });
});

function setDateBadge() {
  const el = document.getElementById('sys-date-badge');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  const cf = document.getElementById('caja-fecha');
  if (cf) cf.textContent = new Date().toLocaleDateString('es-PE');
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════

function setupLoginForm() {
  const btn = document.getElementById('login-btn');
  const emailIn = document.getElementById('login-email');
  const passIn = document.getElementById('login-pass');

  btn?.addEventListener('click', async () => {
    const email = emailIn.value.trim();
    const pass = passIn.value;
    if (!email || !pass) { showLoginError('Completa todos los campos'); return; }

    btn.disabled = true;
    document.getElementById('login-btn-text').style.display = 'none';
    document.getElementById('login-spinner').style.display = 'block';

    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      showLoginError('Credenciales incorrectas. Contacta al administrador.');
      btn.disabled = false;
      document.getElementById('login-btn-text').style.display = 'block';
      document.getElementById('login-spinner').style.display = 'none';
    }
  });

  passIn?.addEventListener('keydown', e => { if (e.key === 'Enter') btn?.click(); });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function handleLogin(user) {
  currentUser = user;

  // Cargar perfil de usuario desde tabla usuarios
  const { data: profile } = await sb.from('usuarios').select('*').eq('auth_id', user.id).single();
  currentUserProfile = profile;

  // Actualizar UI usuario
  const name = profile?.nombre || user.email?.split('@')[0] || 'Usuario';
  const role = profile?.rol || 'recepcionista';
  document.getElementById('sys-user-name').textContent = name;
  document.getElementById('sys-user-role').textContent = rolLabel(role);
  document.getElementById('sys-avatar').textContent = name.charAt(0).toUpperCase();

  // Si es limpieza, solo puede ver habitaciones
  if (role === 'limpieza') {
    document.querySelectorAll('.sys-nav-item').forEach(item => {
      if (item.dataset.sec !== 'habitaciones') item.style.display = 'none';
    });
  }
  // Si no es admin, ocultar usuarios
  if (role !== 'admin') {
    document.querySelectorAll('[data-sec="usuarios"]').forEach(el => el.style.display = 'none');
  }

  showDashboard();
  loadSection('habitaciones');
}

function rolLabel(rol) {
  const map = { admin: 'Administrador', recepcionista: 'Recepcionista', cajero: 'Cajero', limpieza: 'Limpieza' };
  return map[rol] || rol;
}

document.getElementById('sys-logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════════

function setupNavigation() {
  document.querySelectorAll('.sys-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sec = item.dataset.sec;
      if (!sec) return;
      document.querySelectorAll('.sys-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(sec);
      // Mobile: cerrar sidebar
      document.getElementById('sys-sidebar')?.classList.remove('open');
    });
  });

  document.getElementById('sys-menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sys-sidebar')?.classList.toggle('open');
  });
}

const sectionTitles = {
  habitaciones: 'Habitaciones', 'tienda-hab': 'Tienda por Habitación',
  'tienda-publica': 'Tienda Pública', almacen: 'Almacén',
  cajas: 'Cajas del Día', reportes: 'Reportes',
  clientes: 'Clientes', usuarios: 'Usuarios'
};

function loadSection(sec) {
  document.querySelectorAll('.sys-section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`sec-${sec}`);
  if (el) el.classList.add('active');
  document.getElementById('sys-section-title').textContent = sectionTitles[sec] || sec;

  // Cargar datos de cada sección
  const loaders = {
    habitaciones: loadHabitaciones,
    'tienda-hab': loadTiendaHab,
    'tienda-publica': loadTiendaPublica,
    almacen: loadAlmacen,
    cajas: loadCajas,
    reportes: initReportes,
    clientes: loadClientes,
    usuarios: loadUsuarios
  };
  loaders[sec]?.();
}

// ══════════════════════════════════════════════════════════════
//  HABITACIONES
// ══════════════════════════════════════════════════════════════

async function loadHabitaciones() {
  let query = sb.from('habitaciones').select('*').order('numero');

  const piso = document.getElementById('filter-piso')?.value;
  const estado = document.getElementById('filter-estado')?.value;
  if (piso) query = query.eq('piso', parseInt(piso));
  if (estado) query = query.eq('estado', estado);

  const { data, error } = await query;
  if (error) { showToast('Error cargando habitaciones', 'err'); return; }

  renderRoomsGrid(data || []);

  // Filtros
  document.getElementById('filter-piso')?.addEventListener('change', loadHabitaciones);
  document.getElementById('filter-estado')?.addEventListener('change', loadHabitaciones);
}

function renderRoomsGrid(rooms) {
  const grid = document.getElementById('rooms-grid');
  if (!grid) return;
  if (!rooms.length) { grid.innerHTML = '<p style="color:var(--text-light);padding:20px">No hay habitaciones registradas.</p>'; return; }

  grid.innerHTML = rooms.map(r => `
    <div class="room-card-sys" onclick="openRoomModal(${r.id})">
      <div class="room-card-top">
        <div>
          <div class="room-card-num">NRO: ${String(r.numero).padStart(3,'0')}</div>
          <div class="room-card-cat">CATEGORÍA: ${(r.categoria||'').toUpperCase()}</div>
        </div>
        <div class="room-card-icon">${roomIcon(r.estado)}</div>
      </div>
      <div class="room-card-status status-${r.estado || 'disponible'}">
        <span>${(r.estado || 'DISPONIBLE').toUpperCase()}</span>
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `).join('');
}

function roomIcon(estado) {
  const icons = {
    disponible: '🛏️', ocupado: '🔴', limpieza: '🧹', mantenimiento: '🔧', reservado: '📋'
  };
  return icons[estado] || '🛏️';
}

async function openRoomModal(id) {
  const { data: room } = await sb.from('habitaciones').select('*, check_ins(*, clientes(*))').eq('id', id).single();
  if (!room) return;

  document.getElementById('modal-hab-title').textContent = `Habitación ${String(room.numero).padStart(3,'0')} — ${room.categoria}`;

  const checkinActivo = room.check_ins?.find(c => !c.check_out_real);
  const info = document.getElementById('modal-hab-info');
  const actions = document.getElementById('modal-hab-actions');

  info.innerHTML = `
    <h2>Habitación ${String(room.numero).padStart(3,'0')}</h2>
    <div class="modal-info-row"><span>Estado</span><span><span class="badge badge-${badgeColor(room.estado)}">${room.estado}</span></span></div>
    <div class="modal-info-row"><span>Categoría</span><span>${room.categoria}</span></div>
    <div class="modal-info-row"><span>Piso</span><span>${room.piso}</span></div>
    <div class="modal-info-row"><span>Precio/noche</span><span>S/. ${room.precio_noche || '—'}</span></div>
    ${checkinActivo ? `
      <div class="modal-info-row"><span>Huésped</span><span>${checkinActivo.clientes?.nombre || checkinActivo.nombre_huesped}</span></div>
      <div class="modal-info-row"><span>Check-in</span><span>${formatDate(checkinActivo.check_in_fecha)}</span></div>
      <div class="modal-info-row"><span>Salida estimada</span><span>${formatDate(checkinActivo.check_out_estimado)}</span></div>
    ` : ''}
  `;

  actions.innerHTML = '';

  if (room.estado === 'disponible' || room.estado === 'reservado') {
    addBtn(actions, '✅ Check-in', 'sys-btn-gold', () => { openCheckinModal(room); closeModal('modal-habitacion'); });
  }
  if (room.estado === 'ocupado' && checkinActivo) {
    addBtn(actions, '🚪 Check-out', 'sys-btn-red', () => { openCheckoutModal(room, checkinActivo); closeModal('modal-habitacion'); });
  }

  // Cambiar estado
  const estados = ['disponible', 'ocupado', 'limpieza', 'mantenimiento', 'reservado'].filter(e => e !== room.estado);
  const stateSelect = document.createElement('select');
  stateSelect.className = 'sys-select';
  stateSelect.innerHTML = `<option value="">Cambiar estado...</option>` + estados.map(e => `<option value="${e}">${e}</option>`).join('');
  stateSelect.addEventListener('change', async () => {
    if (!stateSelect.value) return;
    await sb.from('habitaciones').update({ estado: stateSelect.value }).eq('id', id);
    showToast('Estado actualizado', 'ok');
    closeModal('modal-habitacion');
    loadHabitaciones();
  });
  actions.appendChild(stateSelect);

  openModal('modal-habitacion');
}

function addBtn(container, text, cls, fn) {
  const btn = document.createElement('button');
  btn.className = `sys-btn ${cls}`;
  btn.innerHTML = text;
  btn.addEventListener('click', fn);
  container.appendChild(btn);
}

function badgeColor(estado) {
  const map = { disponible: 'verde', ocupado: 'rojo', limpieza: 'celeste', mantenimiento: 'amarillo', reservado: 'naranja' };
  return map[estado] || 'gold';
}

// ── CHECK-IN ─────────────────────────────────────────────────

function openCheckinModal(room) {
  document.getElementById('ci-hab-num').textContent = String(room.numero).padStart(3,'0');
  document.getElementById('ci-precio').value = room.precio_noche || '';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('ci-entrada').value = today;
  const manana = new Date(); manana.setDate(manana.getDate()+1);
  document.getElementById('ci-salida').value = manana.toISOString().split('T')[0];

  document.getElementById('btn-confirmar-checkin').onclick = async () => {
    await confirmarCheckin(room.id, room.numero);
  };
  openModal('modal-checkin');
}

async function confirmarCheckin(habId, habNum) {
  const nombre = document.getElementById('ci-nombre').value.trim();
  const dni = document.getElementById('ci-dni').value.trim();
  if (!nombre || !dni) { showToast('Nombre y DNI son obligatorios', 'err'); return; }

  // Buscar o crear cliente
  let clienteId = null;
  const { data: clienteExistente } = await sb.from('clientes').select('id').eq('dni', dni).single();
  if (clienteExistente) {
    clienteId = clienteExistente.id;
  } else {
    const { data: nuevoCliente } = await sb.from('clientes').insert({
      nombre, dni,
      telefono: document.getElementById('ci-tel').value,
      email: document.getElementById('ci-email').value,
    }).select('id').single();
    clienteId = nuevoCliente?.id;
  }

  // Crear check-in
  const { error } = await sb.from('check_ins').insert({
    habitacion_id: habId,
    cliente_id: clienteId,
    nombre_huesped: nombre,
    dni_huesped: dni,
    check_in_fecha: document.getElementById('ci-entrada').value,
    check_out_estimado: document.getElementById('ci-salida').value,
    num_huespedes: parseInt(document.getElementById('ci-huespedes').value) || 1,
    precio_noche: parseFloat(document.getElementById('ci-precio').value) || 0,
    observaciones: document.getElementById('ci-obs').value,
    usuario_id: currentUserProfile?.id,
    caja_id: cajaActual?.id,
  });

  if (error) { showToast('Error al registrar check-in', 'err'); return; }

  await sb.from('habitaciones').update({ estado: 'ocupado' }).eq('id', habId);
  showToast('✅ Check-in registrado correctamente', 'ok');
  closeModal('modal-checkin');
  loadHabitaciones();
}

// ── CHECK-OUT ────────────────────────────────────────────────

async function openCheckoutModal(room, checkin) {
  document.getElementById('co-hab-num').textContent = String(room.numero).padStart(3,'0');

  const entrada = new Date(checkin.check_in_fecha);
  const hoy = new Date();
  const noches = Math.max(1, Math.ceil((hoy - entrada) / (1000*60*60*24)));
  const totalHab = noches * (checkin.precio_noche || 0);

  // Calcular consumos
  const { data: consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre)')
    .eq('check_in_id', checkin.id)
    .is('cobrado', false);

  const totalConsumos = consumos?.reduce((s, c) => s + (c.precio_total || 0), 0) || 0;
  const totalGeneral = totalHab + totalConsumos;

  const summary = document.getElementById('checkout-summary');
  summary.innerHTML = `
    <div class="checkout-row"><span>Huésped</span><span>${checkin.nombre_huesped}</span></div>
    <div class="checkout-row"><span>Noches</span><span>${noches}</span></div>
    <div class="checkout-row"><span>Precio x noche</span><span>S/. ${checkin.precio_noche}</span></div>
    <div class="checkout-row"><span>Total habitación</span><span>S/. ${totalHab.toFixed(2)}</span></div>
    <div class="checkout-row"><span>Consumos extras</span><span>S/. ${totalConsumos.toFixed(2)}</span></div>
    <div class="checkout-row"><span>TOTAL A COBRAR</span><span>S/. ${totalGeneral.toFixed(2)}</span></div>
  `;

  document.getElementById('btn-confirmar-checkout').onclick = async () => {
    await confirmarCheckout(room.id, checkin.id, totalGeneral, consumos);
  };
  openModal('modal-checkout');
}

async function confirmarCheckout(habId, checkinId, total, consumos) {
  await sb.from('check_ins').update({ check_out_real: new Date().toISOString(), total_cobrado: total }).eq('id', checkinId);
  await sb.from('habitaciones').update({ estado: 'limpieza' }).eq('id', habId);

  if (consumos?.length) {
    await sb.from('consumos_habitacion').update({ cobrado: true }).in('id', consumos.map(c => c.id));
  }

  // Registrar en caja
  if (cajaActual) {
    await sb.from('movimientos_caja').insert({
      caja_id: cajaActual.id,
      concepto: `Check-out habitación ${habId}`,
      tipo: 'ingreso',
      monto: total,
      usuario_id: currentUserProfile?.id,
    });
  }

  showToast('🚪 Check-out completado. Habitación en limpieza.', 'ok');
  closeModal('modal-checkout');
  loadHabitaciones();
}

// ══════════════════════════════════════════════════════════════
//  TIENDA POR HABITACIÓN
// ══════════════════════════════════════════════════════════════

async function loadTiendaHab() {
  // Cargar habitaciones ocupadas
  const { data: ocupadas } = await sb.from('habitaciones')
    .select('*, check_ins!inner(id, nombre_huesped)')
    .eq('estado', 'ocupado');

  const sel = document.getElementById('sel-hab-tienda');
  if (sel) {
    sel.innerHTML = '<option value="">Seleccionar habitación ocupada...</option>' +
      (ocupadas || []).map(h => {
        const ci = h.check_ins?.[0];
        return `<option value="${h.id}" data-checkin="${ci?.id}">${String(h.numero).padStart(3,'0')} — ${ci?.nombre_huesped || 'Huésped'}</option>`;
      }).join('');
    sel.addEventListener('change', loadConsumosHab);
  }

  // Cargar productos para catálogo rápido
  loadProductsQuick('products-quick');

  document.getElementById('btn-nueva-venta-hab')?.addEventListener('click', () => {
    const opt = sel?.options[sel.selectedIndex];
    const checkinId = opt?.dataset.checkin;
    if (!checkinId) { showToast('Selecciona una habitación primero', 'err'); return; }
    // El click en producto agrega al consumo
    showToast('Haz clic en un producto para agregar el consumo', 'ok');
  });
}

async function loadConsumosHab() {
  const sel = document.getElementById('sel-hab-tienda');
  const checkinId = sel?.options[sel.selectedIndex]?.dataset.checkin;
  if (!checkinId) return;

  const { data: consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre, precio_venta)')
    .eq('check_in_id', checkinId)
    .is('cobrado', false)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('consumos-hab-list');
  const total = consumos?.reduce((s,c) => s + (c.precio_total||0), 0) || 0;

  tbody.innerHTML = consumos?.length
    ? consumos.map(c => `
        <tr>
          <td>${c.productos?.nombre || '—'}</td>
          <td>${c.cantidad}</td>
          <td>S/. ${c.precio_unitario?.toFixed(2)}</td>
          <td>S/. ${c.precio_total?.toFixed(2)}</td>
          <td>${formatTime(c.created_at)}</td>
          <td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="eliminarConsumo(${c.id})">✕</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="empty-row">Sin consumos registrados</td></tr>';

  document.getElementById('total-consumos-hab').textContent = `S/. ${total.toFixed(2)}`;
}

async function agregarConsumoHab(productoId, nombre, precio) {
  const sel = document.getElementById('sel-hab-tienda');
  const checkinId = sel?.options[sel.selectedIndex]?.dataset.checkin;
  if (!checkinId) { showToast('Selecciona una habitación primero', 'err'); return; }

  await sb.from('consumos_habitacion').insert({
    check_in_id: checkinId,
    producto_id: productoId,
    cantidad: 1,
    precio_unitario: precio,
    precio_total: precio,
    usuario_id: currentUserProfile?.id,
  });

  // Descontar stock
  await sb.rpc('descontar_stock', { p_producto_id: productoId, p_cantidad: 1 });

  showToast(`+1 ${nombre} agregado`, 'ok');
  loadConsumosHab();
}

async function eliminarConsumo(id) {
  await sb.from('consumos_habitacion').delete().eq('id', id);
  showToast('Consumo eliminado', 'ok');
  loadConsumosHab();
}

// ══════════════════════════════════════════════════════════════
//  TIENDA PÚBLICA
// ══════════════════════════════════════════════════════════════

async function loadTiendaPublica() {
  carritoPublico = {};
  loadProductsQuick('products-catalog', true);

  // Ventas de hoy
  const hoy = new Date().toISOString().split('T')[0];
  const { data: ventas } = await sb.from('ventas_publicas')
    .select('*, usuarios(nombre)')
    .gte('created_at', hoy)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('ventas-pub-list');
  tbody.innerHTML = ventas?.length
    ? ventas.map(v => `
        <tr>
          <td>${formatTime(v.created_at)}</td>
          <td>${v.detalle || '—'}</td>
          <td>S/. ${v.total?.toFixed(2)}</td>
          <td>${v.usuarios?.nombre || '—'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="empty-row">Sin ventas hoy</td></tr>';

  document.getElementById('btn-confirmar-venta-pub')?.addEventListener('click', confirmarVentaPublica);

  document.getElementById('search-product-pub')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.product-quick-card').forEach(card => {
      const name = card.querySelector('.pq-name')?.textContent.toLowerCase();
      card.style.display = name?.includes(q) ? '' : 'none';
    });
  });
}

async function confirmarVentaPublica() {
  const items = Object.entries(carritoPublico).filter(([,q]) => q > 0);
  if (!items.length) { showToast('Agrega productos primero', 'err'); return; }

  let total = 0;
  const detalles = [];
  for (const [prodId, cant] of items) {
    const { data: prod } = await sb.from('productos').select('nombre, precio_venta').eq('id', prodId).single();
    const subtotal = (prod?.precio_venta || 0) * cant;
    total += subtotal;
    detalles.push(`${cant}x ${prod?.nombre}`);
    await sb.rpc('descontar_stock', { p_producto_id: parseInt(prodId), p_cantidad: cant });
  }

  await sb.from('ventas_publicas').insert({
    total,
    detalle: detalles.join(', '),
    usuario_id: currentUserProfile?.id,
    caja_id: cajaActual?.id,
  });

  if (cajaActual) {
    await sb.from('movimientos_caja').insert({
      caja_id: cajaActual.id,
      concepto: `Venta pública: ${detalles.join(', ')}`,
      tipo: 'ingreso',
      monto: total,
      usuario_id: currentUserProfile?.id,
    });
  }

  carritoPublico = {};
  document.getElementById('total-pub-display').textContent = 'S/. 0.00';
  showToast(`✅ Venta registrada: S/. ${total.toFixed(2)}`, 'ok');
  loadTiendaPublica();
}

// ── Productos quick (shared) ─────────────────────────────────

async function loadProductsQuick(containerId, isPublic = false) {
  const { data: prods } = await sb.from('productos').select('*').eq('activo', true).order('nombre');
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = prods?.length
    ? prods.map(p => `
        <div class="product-quick-card ${p.stock <= 0 ? 'no-stock' : ''}"
             onclick="${p.stock > 0 ? (isPublic ? `addToCarritoPublico(${p.id}, '${escStr(p.nombre)}', ${p.precio_venta})` : `agregarConsumoHab(${p.id}, '${escStr(p.nombre)}', ${p.precio_venta})`) : ''}">
          <div class="pq-name">${p.nombre}</div>
          <div class="pq-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="pq-stock">Stock: ${p.stock}</div>
          ${isPublic ? `<div class="pq-carrito" id="carrito-${p.id}" style="font-size:11px;color:var(--gold);font-weight:600;min-height:16px"></div>` : ''}
        </div>
      `).join('')
    : '<p style="padding:16px;color:var(--text-light)">No hay productos en almacén.</p>';
}

function addToCarritoPublico(prodId, nombre, precio) {
  carritoPublico[prodId] = (carritoPublico[prodId] || 0) + 1;
  const el = document.getElementById(`carrito-${prodId}`);
  if (el) el.textContent = `× ${carritoPublico[prodId]}`;

  const total = Object.entries(carritoPublico).reduce((s, [id, q]) => {
    // precio aproximado; se recalcula al confirmar
    return s + q * precio;
  }, 0);
  // No podemos usar precios precisos sin fetch, solo aproximado para UI
  recalcTotal();
}

async function recalcTotal() {
  let total = 0;
  for (const [prodId, cant] of Object.entries(carritoPublico)) {
    const { data: p } = await sb.from('productos').select('precio_venta').eq('id', prodId).single();
    total += (p?.precio_venta || 0) * cant;
  }
  document.getElementById('total-pub-display').textContent = `S/. ${total.toFixed(2)}`;
}

// ══════════════════════════════════════════════════════════════
//  ALMACÉN
// ══════════════════════════════════════════════════════════════

async function loadAlmacen() {
  const { data: prods } = await sb.from('productos').select('*').order('nombre');

  // Stats
  const stats = document.getElementById('almacen-stats');
  const total = prods?.length || 0;
  const sinStock = prods?.filter(p => p.stock <= 0).length || 0;
  const stockBajo = prods?.filter(p => p.stock > 0 && p.stock <= (p.stock_minimo || 5)).length || 0;
  stats.innerHTML = `
    <div class="stat-card-sys"><p>Total productos</p><h3>${total}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#dc2626"><p>Sin stock</p><h3>${sinStock}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#ca8a04"><p>Stock bajo</p><h3>${stockBajo}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Activos</p><h3>${prods?.filter(p=>p.activo).length||0}</h3></div>
  `;

  // Tabla
  const tbody = document.getElementById('products-table');
  tbody.innerHTML = prods?.length
    ? prods.map(p => `
        <tr>
          <td>${p.codigo || '—'}</td>
          <td><strong>${p.nombre}</strong></td>
          <td>${p.categoria || '—'}</td>
          <td>S/. ${p.precio_compra?.toFixed(2) || '0.00'}</td>
          <td>S/. ${p.precio_venta?.toFixed(2) || '0.00'}</td>
          <td><strong>${p.stock}</strong></td>
          <td>${p.stock_minimo || 5}</td>
          <td><span class="badge ${p.stock <= 0 ? 'badge-rojo' : p.stock <= (p.stock_minimo||5) ? 'badge-amarillo' : 'badge-verde'}">${p.stock <= 0 ? 'Sin stock' : p.stock <= (p.stock_minimo||5) ? 'Stock bajo' : 'OK'}</span></td>
          <td>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editProduct(${p.id})">Editar</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleProduct(${p.id}, ${!p.activo})">${p.activo ? 'Desactivar' : 'Activar'}</button>
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="9" class="empty-row">No hay productos registrados</td></tr>';

  document.getElementById('btn-add-product')?.addEventListener('click', () => {
    document.getElementById('prod-id').value = '';
    document.getElementById('modal-prod-title').textContent = 'Nuevo producto';
    ['prod-nombre','prod-codigo','prod-precio-compra','prod-precio-venta','prod-stock','prod-stock-min'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    openModal('modal-producto');
  });
}

async function editProduct(id) {
  const { data: p } = await sb.from('productos').select('*').eq('id', id).single();
  document.getElementById('prod-id').value = id;
  document.getElementById('modal-prod-title').textContent = 'Editar producto';
  document.getElementById('prod-nombre').value = p.nombre || '';
  document.getElementById('prod-codigo').value = p.codigo || '';
  document.getElementById('prod-categoria').value = p.categoria || 'otros';
  document.getElementById('prod-precio-compra').value = p.precio_compra || '';
  document.getElementById('prod-precio-venta').value = p.precio_venta || '';
  document.getElementById('prod-stock').value = p.stock || 0;
  document.getElementById('prod-stock-min').value = p.stock_minimo || 5;
  openModal('modal-producto');
}

async function toggleProduct(id, estado) {
  await sb.from('productos').update({ activo: estado }).eq('id', id);
  showToast('Producto actualizado', 'ok');
  loadAlmacen();
}

document.getElementById('btn-guardar-producto')?.addEventListener('click', async () => {
  const id = document.getElementById('prod-id').value;
  const data = {
    nombre: document.getElementById('prod-nombre').value.trim(),
    codigo: document.getElementById('prod-codigo').value.trim(),
    categoria: document.getElementById('prod-categoria').value,
    precio_compra: parseFloat(document.getElementById('prod-precio-compra').value) || 0,
    precio_venta: parseFloat(document.getElementById('prod-precio-venta').value) || 0,
    stock: parseInt(document.getElementById('prod-stock').value) || 0,
    stock_minimo: parseInt(document.getElementById('prod-stock-min').value) || 5,
    activo: true,
  };
  if (!data.nombre) { showToast('El nombre es obligatorio', 'err'); return; }

  if (id) {
    await sb.from('productos').update(data).eq('id', id);
  } else {
    await sb.from('productos').insert(data);
  }
  showToast('Producto guardado ✓', 'ok');
  closeModal('modal-producto');
  loadAlmacen();
});

// ══════════════════════════════════════════════════════════════
//  CAJAS
// ══════════════════════════════════════════════════════════════

async function loadCajas() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: cajas } = await sb.from('cajas')
    .select('*, usuarios(nombre)')
    .eq('fecha', hoy)
    .order('created_at');

  const grid = document.getElementById('cajas-grid');
  grid.innerHTML = cajas?.length
    ? cajas.map(c => `
        <div class="caja-card ${c.estado === 'abierta' ? 'caja-abierta' : 'caja-cerrada'}">
          <h4>Caja ${c.id}</h4>
          <div class="caja-user">👤 ${c.usuarios?.nombre || '—'}</div>
          <div class="caja-total">S/. ${(c.total || 0).toFixed(2)}</div>
          <div class="caja-sub">Estado: ${c.estado} | Apertura: ${formatTime(c.created_at)}</div>
          ${c.estado === 'abierta' && c.usuario_id === currentUserProfile?.id
            ? `<button class="sys-btn sys-btn-outline sys-btn-sm" style="margin-top:12px" onclick="cerrarCaja(${c.id})">Cerrar caja</button>`
            : ''}
        </div>
      `).join('')
    : '<p style="color:var(--text-light)">No hay cajas abiertas hoy. Abre tu caja para comenzar.</p>';

  // Buscar caja del usuario actual
  cajaActual = cajas?.find(c => c.usuario_id === currentUserProfile?.id && c.estado === 'abierta') || null;

  document.getElementById('btn-abrir-caja')?.addEventListener('click', abrirCaja);

  // Movimientos de mi caja
  if (cajaActual) {
    const { data: movs } = await sb.from('movimientos_caja')
      .select('*').eq('caja_id', cajaActual.id).order('created_at', { ascending: false });
    const tbody = document.getElementById('caja-movimientos');
    tbody.innerHTML = movs?.length
      ? movs.map(m => `
          <tr>
            <td>${formatTime(m.created_at)}</td>
            <td>${m.concepto}</td>
            <td><span class="badge ${m.tipo === 'ingreso' ? 'badge-verde' : 'badge-rojo'}">${m.tipo}</span></td>
            <td>S/. ${m.monto?.toFixed(2)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  }
}

async function abrirCaja() {
  if (cajaActual) { showToast('Ya tienes una caja abierta hoy', 'err'); return; }
  const hoy = new Date().toISOString().split('T')[0];
  const { data, error } = await sb.from('cajas').insert({
    usuario_id: currentUserProfile?.id,
    fecha: hoy,
    estado: 'abierta',
    total: 0,
  }).select().single();
  if (error) { showToast('Error al abrir caja', 'err'); return; }
  cajaActual = data;
  showToast('✅ Caja abierta', 'ok');
  loadCajas();
}

async function cerrarCaja(id) {
  await sb.from('cajas').update({ estado: 'cerrada' }).eq('id', id);
  cajaActual = null;
  showToast('Caja cerrada ✓', 'ok');
  loadCajas();
}

// ══════════════════════════════════════════════════════════════
//  REPORTES
// ══════════════════════════════════════════════════════════════

function initReportes() {
  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  document.getElementById('reporte-desde').value = primerDia;
  document.getElementById('reporte-hasta').value = hoy.toISOString().split('T')[0];
  document.getElementById('btn-generar-reporte')?.addEventListener('click', generarReporte);
}

async function generarReporte() {
  const desde = document.getElementById('reporte-desde').value;
  const hasta = document.getElementById('reporte-hasta').value + 'T23:59:59';
  if (!desde || !hasta) { showToast('Selecciona el rango de fechas', 'err'); return; }

  // Check-ins en el período
  const { data: checkins } = await sb.from('check_ins')
    .select('*, habitaciones(numero, categoria), clientes(nombre)')
    .gte('check_in_fecha', desde)
    .lte('check_in_fecha', hasta)
    .order('check_in_fecha', { ascending: false });

  // Ventas públicas en el período
  const { data: ventas } = await sb.from('ventas_publicas')
    .select('*, consumos_habitacion(producto_id, cantidad, precio_total, productos(nombre))')
    .gte('created_at', desde)
    .lte('created_at', hasta);

  const totalHab = checkins?.reduce((s,c) => s + (c.total_cobrado || 0), 0) || 0;
  const totalVentas = ventas?.reduce((s,v) => s + (v.total || 0), 0) || 0;
  const totalGeneral = totalHab + totalVentas;

  // Stats
  document.getElementById('reporte-stats').innerHTML = `
    <div class="stat-card-sys"><p>Check-ins</p><h3>${checkins?.length || 0}</h3></div>
    <div class="stat-card-sys"><p>Ingreso habitaciones</p><h3>S/. ${totalHab.toFixed(2)}</h3></div>
    <div class="stat-card-sys"><p>Ingreso ventas</p><h3>S/. ${totalVentas.toFixed(2)}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>TOTAL GENERAL</p><h3>S/. ${totalGeneral.toFixed(2)}</h3></div>
  `;

  // Tabla habitaciones
  const groupHab = {};
  checkins?.forEach(c => {
    const k = c.habitaciones?.numero;
    if (!groupHab[k]) groupHab[k] = { numero: k, categoria: c.habitaciones?.categoria, noches: 0, total: 0 };
    const dias = c.check_out_real ? Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24)) : 0;
    groupHab[k].noches += dias;
    groupHab[k].total += c.total_cobrado || 0;
  });

  document.getElementById('reporte-habitaciones').innerHTML = Object.values(groupHab).length
    ? Object.values(groupHab).map(h => `<tr><td>Hab. ${String(h.numero).padStart(3,'0')} (${h.categoria})</td><td>${h.noches}</td><td>S/. ${h.total.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin datos</td></tr>';

  // Tabla ventas
  document.getElementById('reporte-ventas').innerHTML = ventas?.length
    ? ventas.map(v => `<tr><td>${v.detalle || '—'}</td><td>—</td><td>S/. ${v.total?.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin ventas</td></tr>';

  // Tabla checkins detalle
  document.getElementById('reporte-checkins').innerHTML = checkins?.length
    ? checkins.map(c => {
        const noches = c.check_out_real ? Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24)) : '—';
        return `
          <tr>
            <td>${String(c.habitaciones?.numero||'?').padStart(3,'0')}</td>
            <td>${c.clientes?.nombre || c.nombre_huesped}</td>
            <td>${formatDate(c.check_in_fecha)}</td>
            <td>${c.check_out_real ? formatDate(c.check_out_real) : '<span class="badge badge-verde">Activo</span>'}</td>
            <td>${noches}</td>
            <td>S/. ${((noches||0) * c.precio_noche).toFixed(2)}</td>
            <td>—</td>
            <td>S/. ${c.total_cobrado?.toFixed(2) || '—'}</td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="8" class="empty-row">Sin datos en el período</td></tr>';
}

// ══════════════════════════════════════════════════════════════
//  CLIENTES
// ══════════════════════════════════════════════════════════════

async function loadClientes() {
  const q = document.getElementById('search-cliente')?.value.toLowerCase() || '';
  let query = sb.from('clientes').select('*, check_ins(count)').order('nombre');
  if (q) query = query.or(`nombre.ilike.%${q}%,dni.ilike.%${q}%`);

  const { data: clientes } = await query;

  document.getElementById('clientes-table').innerHTML = clientes?.length
    ? clientes.map(c => `
        <tr>
          <td><strong>${c.nombre}</strong></td>
          <td>${c.dni || '—'}</td>
          <td>${c.telefono || '—'}</td>
          <td>${c.email || '—'}</td>
          <td>${c.ultima_estancia ? formatDate(c.ultima_estancia) : '—'}</td>
          <td>${c.check_ins?.[0]?.count || 0}</td>
          <td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editCliente(${c.id})">Editar</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="7" class="empty-row">No se encontraron clientes</td></tr>';

  document.getElementById('search-cliente')?.addEventListener('input', loadClientes);
  document.getElementById('btn-add-cliente')?.addEventListener('click', () => {
    document.getElementById('cli-id').value = '';
    document.getElementById('modal-cli-title').textContent = 'Nuevo cliente';
    ['cli-nombre','cli-dni','cli-tel','cli-email','cli-obs'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    openModal('modal-cliente');
  });
}

async function editCliente(id) {
  const { data: c } = await sb.from('clientes').select('*').eq('id', id).single();
  document.getElementById('cli-id').value = id;
  document.getElementById('modal-cli-title').textContent = 'Editar cliente';
  document.getElementById('cli-nombre').value = c.nombre || '';
  document.getElementById('cli-dni').value = c.dni || '';
  document.getElementById('cli-tel').value = c.telefono || '';
  document.getElementById('cli-email').value = c.email || '';
  document.getElementById('cli-obs').value = c.observaciones || '';
  openModal('modal-cliente');
}

document.getElementById('btn-guardar-cliente')?.addEventListener('click', async () => {
  const id = document.getElementById('cli-id').value;
  const data = {
    nombre: document.getElementById('cli-nombre').value.trim(),
    dni: document.getElementById('cli-dni').value.trim(),
    telefono: document.getElementById('cli-tel').value.trim(),
    email: document.getElementById('cli-email').value.trim(),
    observaciones: document.getElementById('cli-obs').value.trim(),
  };
  if (!data.nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  if (id) { await sb.from('clientes').update(data).eq('id', id); }
  else { await sb.from('clientes').insert(data); }
  showToast('Cliente guardado ✓', 'ok');
  closeModal('modal-cliente');
  loadClientes();
});

// ══════════════════════════════════════════════════════════════
//  USUARIOS
// ══════════════════════════════════════════════════════════════

async function loadUsuarios() {
  const { data: users } = await sb.from('usuarios').select('*').order('nombre');

  document.getElementById('users-table').innerHTML = users?.length
    ? users.map(u => `
        <tr>
          <td><strong>${u.nombre}</strong></td>
          <td>${u.email || '—'}</td>
          <td><span class="badge badge-gold">${rolLabel(u.rol)}</span></td>
          <td><span class="badge ${u.activo ? 'badge-verde' : 'badge-rojo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td>${u.ultimo_acceso ? formatDate(u.ultimo_acceso) : 'Nunca'}</td>
          <td>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editUsuario(${u.id})">Editar rol</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleUsuario(${u.id}, ${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button>
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="empty-row">No hay usuarios registrados</td></tr>';

  document.getElementById('btn-add-user')?.addEventListener('click', () => {
    document.getElementById('usr-id').value = '';
    ['usr-nombre','usr-email'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    openModal('modal-usuario');
  });
}

async function editUsuario(id) {
  const { data: u } = await sb.from('usuarios').select('*').eq('id', id).single();
  document.getElementById('usr-id').value = id;
  document.getElementById('usr-nombre').value = u.nombre || '';
  document.getElementById('usr-email').value = u.email || '';
  document.getElementById('usr-rol').value = u.rol || 'recepcionista';
  openModal('modal-usuario');
}

async function toggleUsuario(id, estado) {
  await sb.from('usuarios').update({ activo: estado }).eq('id', id);
  showToast('Usuario actualizado', 'ok');
  loadUsuarios();
}

document.getElementById('btn-guardar-usuario')?.addEventListener('click', async () => {
  const id = document.getElementById('usr-id').value;
  const data = {
    nombre: document.getElementById('usr-nombre').value.trim(),
    rol: document.getElementById('usr-rol').value,
  };
  if (id) { await sb.from('usuarios').update(data).eq('id', id); }
  showToast('Usuario actualizado ✓', 'ok');
  closeModal('modal-usuario');
  loadUsuarios();
});

// ══════════════════════════════════════════════════════════════
//  MODALES & UTILS
// ══════════════════════════════════════════════════════════════

function setupModals() {
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal || btn.closest('.sys-modal')?.id;
      if (modalId) closeModal(modalId);
    });
  });
  document.querySelectorAll('.sys-modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); });
  });
}

function openModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
function closeModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }

function showToast(msg, type = 'ok') {
  const t = document.getElementById('sys-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `sys-toast toast-${type}`;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

function escStr(str) { return (str || '').replace(/'/g, "\\'"); }
