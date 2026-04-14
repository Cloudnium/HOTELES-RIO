// ============================================================
//  sistema.js — Sistema de Gestión Interna Hoteles Rio v2
// ============================================================

// ── CONFIGURACIÓN SUPABASE ─────────────────────────────────
const SUPABASE_URL     = 'https://jyzteirrmjangptekmgm.supabase.co';
const SUPABASE_ANON_KEY= 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5enRlaXJybWphbmdwdGVrbWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMjExNTYsImV4cCI6MjA5MTY5NzE1Nn0.Qc85njSX6BE15i3w8WN2SJ8t1vYzAzPDrP_9FRkQQCk';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── ESTADO GLOBAL ──────────────────────────────────────────
let currentUser        = null;
let currentUserProfile = null;
let cajaActual         = null;
let carritoPublico     = {}; // { productoId: { nombre, precio, cantidad } }

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setDateBadge();
  setupLoginForm();
  setupNavigation();
  setupModals();
  setupModalUsuario();

  const { data: { session } } = await sb.auth.getSession();
  if (session) await handleLogin(session.user);

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) await handleLogin(session.user);
    else if (event === 'SIGNED_OUT') showLogin();
  });
});

function setDateBadge() {
  const el = document.getElementById('sys-date-badge');
  if (el) el.textContent = new Date().toLocaleDateString('es-PE',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const cf = document.getElementById('caja-fecha');
  if (cf) cf.textContent = new Date().toLocaleDateString('es-PE');
}

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
function setupLoginForm() {
  const btn    = document.getElementById('login-btn');
  const emailIn= document.getElementById('login-email');
  const passIn = document.getElementById('login-pass');

  btn?.addEventListener('click', async () => {
    const email = emailIn.value.trim();
    const pass  = passIn.value;
    if (!email || !pass) { showLoginError('Completa todos los campos'); return; }

    btn.disabled = true;
    document.getElementById('login-btn-text').style.display = 'none';
    document.getElementById('login-spinner').style.display  = 'block';

    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      showLoginError('Credenciales incorrectas. Contacta al administrador.');
      btn.disabled = false;
      document.getElementById('login-btn-text').style.display = 'block';
      document.getElementById('login-spinner').style.display  = 'none';
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
  let { data: profile } = await sb.from('usuarios').select('*').eq('auth_id', user.id).single();
  // Si no existe perfil todavía (trigger aún no corrió), crearlo
  if (!profile) {
    const { data: p } = await sb.from('usuarios').insert({
      auth_id: user.id, email: user.email,
      nombre: user.user_metadata?.nombre || user.email.split('@')[0],
      rol: user.user_metadata?.rol || 'recepcionista'
    }).select().single();
    profile = p;
  }
  currentUserProfile = profile;

  const name = profile?.nombre || user.email.split('@')[0];
  const role = profile?.rol || 'recepcionista';
  document.getElementById('sys-user-name').textContent  = name;
  document.getElementById('sys-user-role').textContent  = rolLabel(role);
  document.getElementById('sys-avatar').textContent     = name.charAt(0).toUpperCase();

  if (role === 'limpieza') {
    document.querySelectorAll('.sys-nav-item').forEach(item => {
      if (item.dataset.sec !== 'habitaciones') item.style.display = 'none';
    });
  }
  if (role !== 'admin') {
    document.querySelectorAll('[data-sec="usuarios"]').forEach(el => el.style.display='none');
  }
  showDashboard();
  loadSection('habitaciones');
}

function rolLabel(rol) {
  return { admin:'Administrador', recepcionista:'Recepcionista', cajero:'Cajero', limpieza:'Limpieza' }[rol] || rol;
}

document.getElementById('sys-logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

function showLogin()     { document.getElementById('login-screen').style.display='flex'; document.getElementById('dashboard').style.display='none'; }
function showDashboard() { document.getElementById('login-screen').style.display='none'; document.getElementById('dashboard').style.display='flex'; }

// ══════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.sys-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sec = item.dataset.sec; if (!sec) return;
      document.querySelectorAll('.sys-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(sec);
      document.getElementById('sys-sidebar')?.classList.remove('open');
    });
  });
  document.getElementById('sys-menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sys-sidebar')?.classList.toggle('open');
  });
}

const sectionTitles = {
  habitaciones:'Habitaciones', 'tienda-hab':'Tienda por Habitación',
  'tienda-publica':'Tienda Pública', almacen:'Almacén',
  cajas:'Cajas del Día', reportes:'Reportes',
  clientes:'Clientes', usuarios:'Usuarios'
};

function loadSection(sec) {
  document.querySelectorAll('.sys-section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`sec-${sec}`);
  if (el) el.classList.add('active');
  document.getElementById('sys-section-title').textContent = sectionTitles[sec] || sec;
  const loaders = {
    habitaciones: loadHabitaciones, 'tienda-hab': loadTiendaHab,
    'tienda-publica': loadTiendaPublica, almacen: loadAlmacen,
    cajas: loadCajas, reportes: initReportes,
    clientes: loadClientes, usuarios: loadUsuarios
  };
  loaders[sec]?.();
}

// ══════════════════════════════════════════════════════════
//  HABITACIONES
// ══════════════════════════════════════════════════════════
async function loadHabitaciones() {
  let query = sb.from('habitaciones').select('*').order('numero');
  const piso   = document.getElementById('filter-piso')?.value;
  const estado = document.getElementById('filter-estado')?.value;
  if (piso)   query = query.eq('piso', parseInt(piso));
  if (estado) query = query.eq('estado', estado);
  const { data } = await query;
  renderRoomsGrid(data || []);

  // Re-bind filters (solo 1 vez)
  const fp = document.getElementById('filter-piso');
  const fe = document.getElementById('filter-estado');
  if (fp && !fp._bound) { fp._bound=true; fp.addEventListener('change', loadHabitaciones); }
  if (fe && !fe._bound) { fe._bound=true; fe.addEventListener('change', loadHabitaciones); }
}

function renderRoomsGrid(rooms) {
  const grid = document.getElementById('rooms-grid');
  if (!grid) return;
  if (!rooms.length) { grid.innerHTML='<p style="color:var(--text-light);padding:20px">No hay habitaciones registradas.</p>'; return; }
  grid.innerHTML = rooms.map(r => `
    <div class="room-card-sys" onclick="openRoomModal(${r.id})">
      <div class="room-card-top">
        <div>
          <div class="room-card-num">NRO: ${String(r.numero).padStart(3,'0')}</div>
          <div class="room-card-cat">CATEGORÍA: ${(r.categoria||'').toUpperCase()}</div>
        </div>
        <div class="room-card-icon">${roomIcon(r.estado)}</div>
      </div>
      <div class="room-card-status status-${r.estado||'disponible'}">
        <span>${(r.estado||'DISPONIBLE').toUpperCase()}</span>
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`).join('');
}

function roomIcon(e) {
  return { disponible:'🛏️', ocupado:'🔴', limpieza:'🧹', mantenimiento:'🔧', reservado:'📋' }[e]||'🛏️';
}

async function openRoomModal(id) {
  const { data: room } = await sb.from('habitaciones')
    .select('*').eq('id', id).single();
  if (!room) return;

  // Buscar check-in activo
  const { data: checkins } = await sb.from('check_ins')
    .select('*, clientes(nombre)').eq('habitacion_id', id).is('check_out_real', null);
  const checkinActivo = checkins?.[0];

  document.getElementById('modal-hab-title').textContent =
    `Habitación ${String(room.numero).padStart(3,'0')} — ${room.categoria}`;

  const info    = document.getElementById('modal-hab-info');
  const actions = document.getElementById('modal-hab-actions');

  info.innerHTML = `
    <h2>Habitación ${String(room.numero).padStart(3,'0')}</h2>
    <div class="modal-info-row"><span>Estado</span><span><span class="badge badge-${badgeColor(room.estado)}">${room.estado}</span></span></div>
    <div class="modal-info-row"><span>Categoría</span><span>${room.categoria}</span></div>
    <div class="modal-info-row"><span>Piso</span><span>${room.piso}</span></div>
    <div class="modal-info-row"><span>Precio/noche</span><span>S/. ${room.precio_noche||'—'}</span></div>
    ${checkinActivo ? `
      <div class="modal-info-row"><span>Huésped</span><span>${checkinActivo.clientes?.nombre||checkinActivo.nombre_huesped}</span></div>
      <div class="modal-info-row"><span>Check-in</span><span>${formatDate(checkinActivo.check_in_fecha)}</span></div>
      <div class="modal-info-row"><span>Salida estimada</span><span>${formatDate(checkinActivo.check_out_estimado)}</span></div>
    ` : ''}`;

  actions.innerHTML = '';
  if (room.estado === 'disponible' || room.estado === 'reservado') {
    addBtn(actions,'✅ Check-in','sys-btn-gold',() => { openCheckinModal(room); closeModal('modal-habitacion'); });
  }
  if (room.estado === 'ocupado' && checkinActivo) {
    addBtn(actions,'🚪 Check-out','sys-btn-red',() => { openCheckoutModal(room, checkinActivo); closeModal('modal-habitacion'); });
  }

  const estados = ['disponible','ocupado','limpieza','mantenimiento','reservado'].filter(e => e !== room.estado);
  const stateSelect = document.createElement('select');
  stateSelect.className = 'sys-select';
  stateSelect.innerHTML = `<option value="">Cambiar estado...</option>` + estados.map(e=>`<option value="${e}">${e}</option>`).join('');
  stateSelect.addEventListener('change', async () => {
    if (!stateSelect.value) return;
    await sb.from('habitaciones').update({ estado: stateSelect.value }).eq('id', id);
    showToast('Estado actualizado','ok');
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

function badgeColor(e) {
  return { disponible:'verde', ocupado:'rojo', limpieza:'celeste', mantenimiento:'amarillo', reservado:'naranja' }[e]||'gold';
}

// ── CHECK-IN ───────────────────────────────────────────────
function openCheckinModal(room) {
  document.getElementById('ci-hab-num').textContent = String(room.numero).padStart(3,'0');
  document.getElementById('ci-precio').value = room.precio_noche||'';
  const today  = new Date().toISOString().split('T')[0];
  const manana = new Date(); manana.setDate(manana.getDate()+1);
  document.getElementById('ci-entrada').value = today;
  document.getElementById('ci-salida').value  = manana.toISOString().split('T')[0];
  document.getElementById('btn-confirmar-checkin').onclick = () => confirmarCheckin(room.id, room.numero);
  openModal('modal-checkin');
}

async function confirmarCheckin(habId, habNum) {
  const nombre = document.getElementById('ci-nombre').value.trim();
  const dni    = document.getElementById('ci-dni').value.trim();
  if (!nombre||!dni) { showToast('Nombre y DNI son obligatorios','err'); return; }

  let clienteId = null;
  const { data: ce } = await sb.from('clientes').select('id').eq('dni', dni).maybeSingle();
  if (ce) {
    clienteId = ce.id;
  } else {
    const { data: nc } = await sb.from('clientes').insert({
      nombre, dni,
      telefono: document.getElementById('ci-tel').value,
      email:    document.getElementById('ci-email').value,
    }).select('id').single();
    clienteId = nc?.id;
  }

  await sb.from('check_ins').insert({
    habitacion_id:     habId,
    cliente_id:        clienteId,
    nombre_huesped:    nombre,
    dni_huesped:       dni,
    check_in_fecha:    document.getElementById('ci-entrada').value,
    check_out_estimado:document.getElementById('ci-salida').value,
    num_huespedes:     parseInt(document.getElementById('ci-huespedes').value)||1,
    precio_noche:      parseFloat(document.getElementById('ci-precio').value)||0,
    observaciones:     document.getElementById('ci-obs').value,
    usuario_id:        currentUserProfile?.id,
    caja_id:           cajaActual?.id,
  });

  await sb.from('habitaciones').update({ estado:'ocupado' }).eq('id', habId);
  showToast('✅ Check-in registrado','ok');
  closeModal('modal-checkin');
  loadHabitaciones();
}

// ── CHECK-OUT con método de pago ───────────────────────────
async function openCheckoutModal(room, checkin) {
  document.getElementById('co-hab-num').textContent = String(room.numero).padStart(3,'0');

  const entrada = new Date(checkin.check_in_fecha);
  const hoy     = new Date();
  const noches  = Math.max(1, Math.ceil((hoy - entrada)/(1000*60*60*24)));
  const totalHab= noches * (checkin.precio_noche||0);

  const { data: consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre)').eq('check_in_id', checkin.id).is('cobrado', false);
  const totalConsumos = consumos?.reduce((s,c) => s+(c.precio_total||0), 0)||0;
  const totalGeneral  = totalHab + totalConsumos;

  const summary = document.getElementById('checkout-summary');
  summary.innerHTML = `
    <div class="checkout-row"><span>Huésped</span><span>${checkin.nombre_huesped}</span></div>
    <div class="checkout-row"><span>Noches</span><span>${noches}</span></div>
    <div class="checkout-row"><span>Precio x noche</span><span>S/. ${(checkin.precio_noche||0).toFixed(2)}</span></div>
    <div class="checkout-row"><span>Total habitación</span><span>S/. ${totalHab.toFixed(2)}</span></div>
    ${consumos?.length ? consumos.map(c=>`<div class="checkout-row"><span>  • ${c.productos?.nombre||'?'} x${c.cantidad}</span><span>S/. ${c.precio_total?.toFixed(2)}</span></div>`).join(''):''}
    <div class="checkout-row"><span>Consumos extras</span><span>S/. ${totalConsumos.toFixed(2)}</span></div>
    <div class="checkout-row checkout-total"><span>TOTAL A COBRAR</span><span>S/. ${totalGeneral.toFixed(2)}</span></div>

    <div class="pago-section">
      <div class="form-field">
        <label>Método de pago</label>
        <div class="metodo-pago-grid">
          <button class="metodo-btn active" data-metodo="Efectivo">💵 Efectivo</button>
          <button class="metodo-btn" data-metodo="Tarjeta">💳 Tarjeta</button>
          <button class="metodo-btn" data-metodo="Yape">📱 Yape</button>
          <button class="metodo-btn" data-metodo="Plin">📱 Plin</button>
        </div>
      </div>
      <div id="efectivo-section" class="efectivo-section">
        <div class="form-field">
          <label>Efectivo recibido (S/.)</label>
          <input type="number" id="efectivo-recibido" class="sys-input" placeholder="0.00" step="0.01" value="${totalGeneral.toFixed(2)}">
        </div>
        <div class="vuelto-display">
          Vuelto: <strong id="vuelto-display">S/. 0.00</strong>
        </div>
      </div>
    </div>`;

  // Botones método de pago
  let metodoPago = 'Efectivo';
  summary.querySelectorAll('.metodo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      summary.querySelectorAll('.metodo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      metodoPago = btn.dataset.metodo;
      document.getElementById('efectivo-section').style.display =
        metodoPago === 'Efectivo' ? 'block' : 'none';
    });
  });

  // Calcular vuelto
  const efInput = document.getElementById('efectivo-recibido');
  efInput?.addEventListener('input', () => {
    const recibido = parseFloat(efInput.value)||0;
    const vuelto   = Math.max(0, recibido - totalGeneral);
    document.getElementById('vuelto-display').textContent = `S/. ${vuelto.toFixed(2)}`;
    document.getElementById('vuelto-display').style.color = vuelto > 0 ? 'var(--gold)' : 'var(--text-mid)';
  });

  document.getElementById('btn-confirmar-checkout').onclick = async () => {
    const recibido = parseFloat(document.getElementById('efectivo-recibido')?.value)||totalGeneral;
    const vuelto   = metodoPago==='Efectivo' ? Math.max(0, recibido - totalGeneral) : 0;
    await confirmarCheckout(room, checkin, totalGeneral, consumos, metodoPago, vuelto, noches);
  };
  openModal('modal-checkout');
}

async function confirmarCheckout(room, checkin, total, consumos, metodoPago, vuelto, noches) {
  await sb.from('check_ins').update({
    check_out_real: new Date().toISOString(),
    total_cobrado:  total,
    metodo_pago:    metodoPago,
  }).eq('id', checkin.id);

  await sb.from('habitaciones').update({ estado:'limpieza' }).eq('id', room.id);

  if (consumos?.length) {
    await sb.from('consumos_habitacion').update({ cobrado:true }).in('id', consumos.map(c=>c.id));
  }

  if (cajaActual) {
    await sb.from('movimientos_caja').insert({
      caja_id:    cajaActual.id,
      concepto:   `Check-out Hab. ${String(room.numero).padStart(3,'0')} (${metodoPago})`,
      tipo:       'ingreso',
      monto:      total,
      usuario_id: currentUserProfile?.id,
    });
  }

  // Emitir ticket PDF
  generarTicketCheckout(room, checkin, consumos, total, metodoPago, vuelto, noches);

  showToast('🚪 Check-out completado. Habitación en limpieza.','ok');
  closeModal('modal-checkout');
  loadHabitaciones();
}

// ══════════════════════════════════════════════════════════
//  TICKETS PDF (Ticketera Térmica — 80mm)
// ══════════════════════════════════════════════════════════

function printTicket(htmlContent) {
  const win = window.open('','_blank','width=400,height=700');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Ticket</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        font-family: 'Courier New', Courier, monospace;
        font-size: 11px;
        width: 72mm;
        color: #000;
        background: #fff;
      }
      .center { text-align:center; }
      .bold   { font-weight:bold; }
      .big    { font-size:14px; }
      .small  { font-size:9px; }
      .line   { border-top:1px dashed #000; margin:4px 0; }
      .logo   { width:60mm; max-height:25mm; object-fit:contain; display:block; margin:0 auto 4px; }
      table   { width:100%; border-collapse:collapse; }
      td      { padding:1px 0; vertical-align:top; }
      td.r    { text-align:right; white-space:nowrap; }
      .total-row td { border-top:1px dashed #000; font-weight:bold; padding-top:3px; }
      .hab-num { font-size:22px; font-weight:bold; text-align:center; letter-spacing:2px; }
      .hab-cat { font-size:10px; text-align:center; color:#333; }
      @media print {
        body { width:72mm; }
        button { display:none; }
      }
    </style>
  </head><body>
    ${htmlContent}
    <div style="margin-top:12px;text-align:center">
      <button onclick="window.print()" style="padding:8px 20px;font-size:13px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:4px">🖨 Imprimir</button>
    </div>
  </body></html>`);
  win.document.close();
}

function ticketHeader() {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-PE');
  const hora  = now.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' });
  return `
    <div class="center">
      <img src="/images/logos/logo.png" class="logo" onerror="this.style.display='none'">
      <div class="bold big">HOTELES RIO</div>
      <div class="small">Au. Panamericana N 915, Sullana</div>
      <div class="small">Tel: +51 951-149-420</div>
    </div>
    <div class="line"></div>
    <div class="center bold">NOTA DE VENTA</div>
    <div class="line"></div>
    <table><tr>
      <td>F. Emisión:</td><td class="r">${fecha} ${hora}</td>
    </tr></table>
    <div class="line"></div>`;
}

// Ticket Check-out habitación
function generarTicketCheckout(room, checkin, consumos, total, metodoPago, vuelto, noches) {
  const totalHab      = noches * (checkin.precio_noche||0);
  const totalConsumos = consumos?.reduce((s,c)=>s+(c.precio_total||0),0)||0;

  let filasConsumos = '';
  if (consumos?.length) {
    filasConsumos = `
      <div class="line"></div>
      <div class="bold" style="margin-bottom:2px">Consumos:</div>
      <table>
        ${consumos.map(c=>`
          <tr>
            <td>${c.productos?.nombre||'Producto'}</td>
            <td class="r">x${c.cantidad}</td>
            <td class="r">S/.${c.precio_total?.toFixed(2)}</td>
          </tr>`).join('')}
      </table>`;
  }

  let filaPago = metodoPago==='Efectivo' && vuelto >= 0
    ? `<tr><td>Efectivo:</td><td class="r">S/. ${(total+vuelto).toFixed(2)}</td></tr>
       <tr><td>Vuelto:</td><td class="r">S/. ${vuelto.toFixed(2)}</td></tr>`
    : '';

  printTicket(`
    ${ticketHeader()}
    <div style="margin:3px 0"><span class="bold">Cliente:</span> ${checkin.nombre_huesped}</div>
    <div style="margin:2px 0"><span class="bold">DNI:</span> ${checkin.dni_huesped||'—'}</div>
    <div class="line"></div>

    <table>
      <tr>
        <td>Hab. — ${noches} noche(s)</td>
        <td class="r">S/.${totalHab.toFixed(2)}</td>
      </tr>
      <tr><td class="small">Precio x noche: S/.${(checkin.precio_noche||0).toFixed(2)}</td><td></td></tr>
    </table>

    ${filasConsumos}

    <div class="line"></div>
    <table>
      <tr class="total-row">
        <td class="bold">TOTAL A PAGAR:</td>
        <td class="r bold">S/. ${total.toFixed(2)}</td>
      </tr>
    </table>
    <div class="line"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${metodoPago}</td></tr>
      ${filaPago}
    </table>
    <div class="line"></div>

    <div class="hab-num">${String(room.numero).padStart(3,'0')}</div>
    <div class="hab-cat">${(room.categoria||'').toUpperCase()}</div>

    <div class="line"></div>
    <div class="center small">¡Gracias por su visita!</div>
    <div class="center small">Vuelva pronto a Hoteles Rio</div>
    <br><br>`);
}

// Ticket venta pública
function generarTicketVentaPublica(items, total, metodoPago, vuelto, cajero) {
  const filas = items.map(([id, info]) => `
    <tr>
      <td>${info.nombre}</td>
      <td class="r">x${info.cantidad}</td>
      <td class="r">S/.${(info.precio*info.cantidad).toFixed(2)}</td>
    </tr>`).join('');

  let filaPago = metodoPago==='Efectivo' && vuelto >= 0
    ? `<tr><td>Efectivo:</td><td class="r">S/. ${(total+vuelto).toFixed(2)}</td></tr>
       <tr><td>Vuelto:</td><td class="r">S/. ${vuelto.toFixed(2)}</td></tr>`
    : '';

  printTicket(`
    ${ticketHeader()}
    <div class="center bold" style="margin-bottom:3px">VENTA AL PÚBLICO</div>
    <div class="line"></div>
    <div style="margin:2px 0"><span class="bold">Cajero:</span> ${cajero||'—'}</div>
    <div class="line"></div>

    <table>
      <tr><td class="bold">Descripción</td><td class="r bold">Cant.</td><td class="r bold">Total</td></tr>
      ${filas}
      <tr class="total-row">
        <td colspan="2" class="bold">TOTAL:</td>
        <td class="r bold">S/. ${total.toFixed(2)}</td>
      </tr>
    </table>

    <div class="line"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${metodoPago}</td></tr>
      ${filaPago}
    </table>
    <div class="line"></div>
    <div class="center small">¡Gracias por su compra!</div>
    <div class="center small">Hoteles Rio — Sullana</div>
    <br><br>`);
}

// ══════════════════════════════════════════════════════════
//  TIENDA POR HABITACIÓN
// ══════════════════════════════════════════════════════════
async function loadTiendaHab() {
  const { data: ocupadas } = await sb.from('habitaciones')
    .select('numero, id').eq('estado','ocupado').order('numero');

  // Buscar check-ins activos para obtener nombre del huésped
  const ids = ocupadas?.map(h=>h.id)||[];
  let checkinMap = {};
  if (ids.length) {
    const { data: cis } = await sb.from('check_ins')
      .select('habitacion_id, id, nombre_huesped').in('habitacion_id', ids).is('check_out_real', null);
    cis?.forEach(c => { checkinMap[c.habitacion_id] = c; });
  }

  const sel = document.getElementById('sel-hab-tienda');
  if (sel) {
    sel.innerHTML = '<option value="">Seleccionar habitación ocupada...</option>' +
      (ocupadas||[]).map(h => {
        const ci = checkinMap[h.id];
        return `<option value="${h.id}" data-checkin="${ci?.id||''}">${String(h.numero).padStart(3,'0')} — ${ci?.nombre_huesped||'Huésped'}</option>`;
      }).join('');
    if (!sel._bound) { sel._bound=true; sel.addEventListener('change', loadConsumosHab); }
  }

  loadProductsQuick('products-quick', false);

  const btnAdd = document.getElementById('btn-nueva-venta-hab');
  if (btnAdd && !btnAdd._bound) {
    btnAdd._bound = true;
    btnAdd.addEventListener('click', () => {
      const checkinId = sel?.options[sel.selectedIndex]?.dataset.checkin;
      if (!checkinId) { showToast('Selecciona una habitación primero','err'); return; }
      showToast('Haz clic en un producto para agregar al consumo','ok');
    });
  }
}

async function loadConsumosHab() {
  const sel       = document.getElementById('sel-hab-tienda');
  const checkinId = sel?.options[sel.selectedIndex]?.dataset.checkin;
  if (!checkinId) return;

  const { data: consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre, precio_venta)')
    .eq('check_in_id', checkinId).is('cobrado', false)
    .order('created_at', { ascending:false });

  const tbody = document.getElementById('consumos-hab-list');
  const total = consumos?.reduce((s,c)=>s+(c.precio_total||0),0)||0;

  tbody.innerHTML = consumos?.length
    ? consumos.map(c=>`
        <tr>
          <td>${c.productos?.nombre||'—'}</td>
          <td>${c.cantidad}</td>
          <td>S/. ${c.precio_unitario?.toFixed(2)}</td>
          <td>S/. ${c.precio_total?.toFixed(2)}</td>
          <td>${formatTime(c.created_at)}</td>
          <td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="eliminarConsumo(${c.id})">✕</button></td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="empty-row">Sin consumos registrados</td></tr>';

  document.getElementById('total-consumos-hab').textContent = `S/. ${total.toFixed(2)}`;
}

async function agregarConsumoHab(productoId, nombre, precio) {
  const sel       = document.getElementById('sel-hab-tienda');
  const checkinId = sel?.options[sel.selectedIndex]?.dataset.checkin;
  if (!checkinId) { showToast('Selecciona una habitación primero','err'); return; }

  await sb.from('consumos_habitacion').insert({
    check_in_id:   checkinId,
    producto_id:   productoId,
    cantidad:      1,
    precio_unitario: precio,
    precio_total:  precio,
    usuario_id:    currentUserProfile?.id,
  });
  await sb.rpc('descontar_stock', { p_producto_id: productoId, p_cantidad: 1 });
  showToast(`+1 ${nombre} agregado`,'ok');
  loadConsumosHab();
}

async function eliminarConsumo(id) {
  await sb.from('consumos_habitacion').delete().eq('id', id);
  showToast('Consumo eliminado','ok');
  loadConsumosHab();
}

// ══════════════════════════════════════════════════════════
//  TIENDA PÚBLICA
// ══════════════════════════════════════════════════════════
async function loadTiendaPublica() {
  carritoPublico = {};
  await loadProductsQuick('products-catalog', true);
  await loadVentasHoy();
  renderTotalPublico();

  const inp = document.getElementById('search-product-pub');
  if (inp && !inp._bound) {
    inp._bound = true;
    inp.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#products-catalog .product-quick-card').forEach(card => {
        card.style.display = card.querySelector('.pq-name')?.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  const btnConf = document.getElementById('btn-confirmar-venta-pub');
  if (btnConf) { btnConf.onclick = abrirModalVentaPublica; }

  const btnNueva = document.getElementById('btn-nueva-venta-pub');
  if (btnNueva && !btnNueva._bound) {
    btnNueva._bound = true;
    btnNueva.addEventListener('click', () => {
      carritoPublico = {};
      renderTotalPublico();
      document.querySelectorAll('#products-catalog .pq-carrito').forEach(el => el.textContent='');
      showToast('Carrito limpiado','ok');
    });
  }
}

async function loadVentasHoy() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: ventas } = await sb.from('ventas_publicas')
    .select('*, usuarios(nombre)').gte('created_at', hoy).order('created_at',{ascending:false});

  const tbody = document.getElementById('ventas-pub-list');
  if (!tbody) return;
  tbody.innerHTML = ventas?.length
    ? ventas.map(v=>`
        <tr>
          <td>${formatTime(v.created_at)}</td>
          <td>${v.detalle||'—'}</td>
          <td>S/. ${v.total?.toFixed(2)}</td>
          <td>${v.usuarios?.nombre||'—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-row">Sin ventas hoy</td></tr>';
}

function renderTotalPublico() {
  const total = Object.values(carritoPublico).reduce((s,i)=>s+i.precio*i.cantidad,0);
  const el = document.getElementById('total-pub-display');
  if (el) el.textContent = `S/. ${total.toFixed(2)}`;
}

function addToCarritoPublico(prodId, nombre, precio) {
  if (!carritoPublico[prodId]) carritoPublico[prodId] = { nombre, precio, cantidad:0 };
  carritoPublico[prodId].cantidad++;
  const el = document.getElementById(`carrito-${prodId}`);
  if (el) el.textContent = `× ${carritoPublico[prodId].cantidad}`;
  renderTotalPublico();
}

// Modal pago venta pública
function abrirModalVentaPublica() {
  const items = Object.entries(carritoPublico).filter(([,i])=>i.cantidad>0);
  if (!items.length) { showToast('Agrega productos primero','err'); return; }
  const total = items.reduce((s,[,i])=>s+i.precio*i.cantidad,0);

  const modal = document.getElementById('modal-pago-pub');
  if (!modal) return;

  document.getElementById('pago-pub-items').innerHTML = items.map(([,i])=>
    `<div class="checkout-row"><span>${i.nombre} x${i.cantidad}</span><span>S/. ${(i.precio*i.cantidad).toFixed(2)}</span></div>`
  ).join('') + `<div class="checkout-row checkout-total"><span>TOTAL</span><span>S/. ${total.toFixed(2)}</span></div>`;

  document.getElementById('pago-pub-total').textContent = total.toFixed(2);

  // Botones método
  let metodoPub = 'Efectivo';
  modal.querySelectorAll('.metodo-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.metodo === 'Efectivo') btn.classList.add('active');
    btn.onclick = () => {
      modal.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      metodoPub = btn.dataset.metodo;
      document.getElementById('efectivo-pub-section').style.display = metodoPub==='Efectivo'?'block':'none';
    };
  });

  const efInput = document.getElementById('efectivo-pub-recibido');
  if (efInput) {
    efInput.value = total.toFixed(2);
    efInput.oninput = () => {
      const vuelto = Math.max(0, parseFloat(efInput.value||0) - total);
      document.getElementById('vuelto-pub').textContent = `S/. ${vuelto.toFixed(2)}`;
    };
  }

  document.getElementById('btn-confirmar-pago-pub').onclick = async () => {
    const recibido = parseFloat(document.getElementById('efectivo-pub-recibido')?.value)||total;
    const vuelto   = metodoPub==='Efectivo' ? Math.max(0, recibido - total) : 0;
    await confirmarVentaPublica(items, total, metodoPub, vuelto);
    closeModal('modal-pago-pub');
  };
  openModal('modal-pago-pub');
}

async function confirmarVentaPublica(items, total, metodoPago, vuelto) {
  const detalle = items.map(([,i])=>`${i.cantidad}x ${i.nombre}`).join(', ');

  // Descontar stock
  for (const [prodId, info] of items) {
    await sb.rpc('descontar_stock', { p_producto_id: parseInt(prodId), p_cantidad: info.cantidad });
  }

  // Guardar venta con desglose
  const lineas = items.map(([,i])=>({ nombre:i.nombre, cantidad:i.cantidad, precio_unit:i.precio, subtotal:i.precio*i.cantidad }));
  await sb.from('ventas_publicas').insert({
    total, detalle,
    metodo_pago:  metodoPago,
    lineas_json:  JSON.stringify(lineas),
    usuario_id:   currentUserProfile?.id,
    caja_id:      cajaActual?.id,
  });

  if (cajaActual) {
    await sb.from('movimientos_caja').insert({
      caja_id:    cajaActual.id,
      concepto:   `Venta pública: ${detalle}`,
      tipo:       'ingreso',
      monto:      total,
      usuario_id: currentUserProfile?.id,
    });
  }

  // Generar ticket
  const cajero = currentUserProfile?.nombre || 'Sistema';
  generarTicketVentaPublica(items, total, metodoPago, vuelto, cajero);

  carritoPublico = {};
  renderTotalPublico();
  document.querySelectorAll('.pq-carrito').forEach(el=>el.textContent='');
  showToast(`✅ Venta S/. ${total.toFixed(2)} registrada`,'ok');
  await loadVentasHoy();
}

// ══════════════════════════════════════════════════════════
//  ALMACÉN
// ══════════════════════════════════════════════════════════
async function loadAlmacen() {
  const { data: prods } = await sb.from('productos').select('*').order('nombre');
  const stats = document.getElementById('almacen-stats');
  const total    = prods?.length||0;
  const sinStock = prods?.filter(p=>p.stock<=0).length||0;
  const stockBajo= prods?.filter(p=>p.stock>0&&p.stock<=(p.stock_minimo||5)).length||0;
  stats.innerHTML = `
    <div class="stat-card-sys"><p>Total productos</p><h3>${total}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#dc2626"><p>Sin stock</p><h3>${sinStock}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#ca8a04"><p>Stock bajo</p><h3>${stockBajo}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Activos</p><h3>${prods?.filter(p=>p.activo).length||0}</h3></div>`;

  document.getElementById('products-table').innerHTML = prods?.length
    ? prods.map(p=>`
        <tr>
          <td>${p.codigo||'—'}</td>
          <td><strong>${p.nombre}</strong></td>
          <td>${p.categoria||'—'}</td>
          <td>S/. ${p.precio_compra?.toFixed(2)||'0.00'}</td>
          <td>S/. ${p.precio_venta?.toFixed(2)||'0.00'}</td>
          <td><strong>${p.stock}</strong></td>
          <td>${p.stock_minimo||5}</td>
          <td><span class="badge ${p.stock<=0?'badge-rojo':p.stock<=(p.stock_minimo||5)?'badge-amarillo':'badge-verde'}">${p.stock<=0?'Sin stock':p.stock<=(p.stock_minimo||5)?'Stock bajo':'OK'}</span></td>
          <td>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editProduct(${p.id})">Editar</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleProduct(${p.id},${!p.activo})">${p.activo?'Desactivar':'Activar'}</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="9" class="empty-row">No hay productos registrados</td></tr>';

  const btnAdd = document.getElementById('btn-add-product');
  if (btnAdd) btnAdd.onclick = () => {
    document.getElementById('prod-id').value='';
    document.getElementById('modal-prod-title').textContent='Nuevo producto';
    ['prod-nombre','prod-codigo','prod-precio-compra','prod-precio-venta','prod-stock','prod-stock-min']
      .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    openModal('modal-producto');
  };
}

async function editProduct(id) {
  const { data:p } = await sb.from('productos').select('*').eq('id',id).single();
  document.getElementById('prod-id').value               = id;
  document.getElementById('modal-prod-title').textContent= 'Editar producto';
  document.getElementById('prod-nombre').value           = p.nombre||'';
  document.getElementById('prod-codigo').value           = p.codigo||'';
  document.getElementById('prod-categoria').value        = p.categoria||'otros';
  document.getElementById('prod-precio-compra').value    = p.precio_compra||'';
  document.getElementById('prod-precio-venta').value     = p.precio_venta||'';
  document.getElementById('prod-stock').value            = p.stock||0;
  document.getElementById('prod-stock-min').value        = p.stock_minimo||5;
  openModal('modal-producto');
}

async function toggleProduct(id, estado) {
  await sb.from('productos').update({ activo:estado }).eq('id',id);
  showToast('Producto actualizado','ok'); loadAlmacen();
}

document.getElementById('btn-guardar-producto')?.addEventListener('click', async () => {
  const id = document.getElementById('prod-id').value;
  const data = {
    nombre:        document.getElementById('prod-nombre').value.trim(),
    codigo:        document.getElementById('prod-codigo').value.trim(),
    categoria:     document.getElementById('prod-categoria').value,
    precio_compra: parseFloat(document.getElementById('prod-precio-compra').value)||0,
    precio_venta:  parseFloat(document.getElementById('prod-precio-venta').value)||0,
    stock:         parseInt(document.getElementById('prod-stock').value)||0,
    stock_minimo:  parseInt(document.getElementById('prod-stock-min').value)||5,
    activo: true,
  };
  if (!data.nombre) { showToast('El nombre es obligatorio','err'); return; }
  if (id) await sb.from('productos').update(data).eq('id',id);
  else    await sb.from('productos').insert(data);
  showToast('Producto guardado ✓','ok');
  closeModal('modal-producto');
  loadAlmacen();
});

// ── Products quick grid ─────────────────────────────────
async function loadProductsQuick(containerId, isPublic=false) {
  const { data:prods } = await sb.from('productos').select('*').eq('activo',true).order('nombre');
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = prods?.length
    ? prods.map(p=>`
        <div class="product-quick-card ${p.stock<=0?'no-stock':''}"
             onclick="${p.stock>0?(isPublic?`addToCarritoPublico(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`:`agregarConsumoHab(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`):''}">
          <div class="pq-name">${p.nombre}</div>
          <div class="pq-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="pq-stock">Stock: ${p.stock}</div>
          ${isPublic?`<div class="pq-carrito" id="carrito-${p.id}"></div>`:''}
        </div>`).join('')
    : '<p style="padding:16px;color:var(--text-light)">No hay productos.</p>';
}

// ══════════════════════════════════════════════════════════
//  CAJAS
// ══════════════════════════════════════════════════════════
async function loadCajas() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data:cajas } = await sb.from('cajas')
    .select('*, usuarios(nombre)').eq('fecha',hoy).order('created_at');

  cajaActual = cajas?.find(c=>c.usuario_id===currentUserProfile?.id&&c.estado==='abierta')||null;

  const grid = document.getElementById('cajas-grid');
  grid.innerHTML = cajas?.length
    ? cajas.map(c=>`
        <div class="caja-card ${c.estado==='abierta'?'caja-abierta':'caja-cerrada'}">
          <h4>Caja — ${c.usuarios?.nombre||'—'}</h4>
          <div class="caja-user">📅 ${hoy} | Estado: ${c.estado}</div>
          <div class="caja-total">S/. ${(c.total||0).toFixed(2)}</div>
          <div class="caja-sub">Apertura: ${formatTime(c.created_at)}</div>
          ${c.estado==='abierta'&&c.usuario_id===currentUserProfile?.id
            ?`<button class="sys-btn sys-btn-outline sys-btn-sm" style="margin-top:10px" onclick="cerrarCaja(${c.id})">Cerrar caja</button>`:''}
        </div>`).join('')
    : '<p style="color:var(--text-light)">No hay cajas hoy. Abre tu caja para comenzar.</p>';

  const btnAbrir = document.getElementById('btn-abrir-caja');
  if (btnAbrir) btnAbrir.onclick = abrirCaja;

  if (cajaActual) {
    const { data:movs } = await sb.from('movimientos_caja')
      .select('*').eq('caja_id',cajaActual.id).order('created_at',{ascending:false});
    const tbody = document.getElementById('caja-movimientos');
    tbody.innerHTML = movs?.length
      ? movs.map(m=>`
          <tr>
            <td>${formatTime(m.created_at)}</td>
            <td>${m.concepto}</td>
            <td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td>
            <td>S/. ${m.monto?.toFixed(2)}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  }
}

async function abrirCaja() {
  if (cajaActual) { showToast('Ya tienes una caja abierta hoy','err'); return; }
  const hoy = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('cajas').insert({
    usuario_id: currentUserProfile?.id, fecha:hoy, estado:'abierta', total:0
  }).select().single();
  cajaActual = data;
  showToast('✅ Caja abierta','ok');
  loadCajas();
}

async function cerrarCaja(id) {
  await sb.from('cajas').update({ estado:'cerrada' }).eq('id',id);
  cajaActual = null;
  showToast('Caja cerrada ✓','ok');
  loadCajas();
}

// ══════════════════════════════════════════════════════════
//  REPORTES — CORREGIDO
// ══════════════════════════════════════════════════════════
function initReportes() {
  const hoy      = new Date();
  const primerDia= new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  document.getElementById('reporte-desde').value = primerDia;
  document.getElementById('reporte-hasta').value = hoy.toISOString().split('T')[0];
  const btn = document.getElementById('btn-generar-reporte');
  if (btn && !btn._bound) { btn._bound=true; btn.addEventListener('click', generarReporte); }
}

async function generarReporte() {
  const desde = document.getElementById('reporte-desde').value;
  const hasta  = document.getElementById('reporte-hasta').value;
  if (!desde||!hasta) { showToast('Selecciona el rango de fechas','err'); return; }
  const hastaFull = hasta + 'T23:59:59';

  // Check-ins en el período
  const { data:checkins } = await sb.from('check_ins')
    .select('*, habitaciones(numero,categoria), clientes(nombre)')
    .gte('check_in_fecha', desde).lte('check_in_fecha', hasta)
    .order('check_in_fecha',{ascending:false});

  // Ventas públicas en el período — usando created_at con timestamp completo
  const { data:ventas } = await sb.from('ventas_publicas')
    .select('*').gte('created_at', desde+'T00:00:00').lte('created_at', hastaFull)
    .order('created_at',{ascending:false});

  // Consumos por habitación en el período
  const { data:consumosHab } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre)').gte('created_at', desde+'T00:00:00').lte('created_at', hastaFull);

  const totalHab     = checkins?.reduce((s,c)=>s+(c.total_cobrado||0),0)||0;
  const totalVentas  = ventas?.reduce((s,v)=>s+(v.total||0),0)||0;
  const totalConsumos= consumosHab?.reduce((s,c)=>s+(c.precio_total||0),0)||0;
  const totalGeneral = totalHab + totalVentas;

  document.getElementById('reporte-stats').innerHTML = `
    <div class="stat-card-sys"><p>Check-ins</p><h3>${checkins?.length||0}</h3></div>
    <div class="stat-card-sys"><p>Ingreso habitaciones</p><h3>S/. ${totalHab.toFixed(2)}</h3></div>
    <div class="stat-card-sys"><p>Ingreso ventas</p><h3>S/. ${totalVentas.toFixed(2)}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>TOTAL GENERAL</p><h3>S/. ${totalGeneral.toFixed(2)}</h3></div>`;

  // Agrupar habitaciones
  const groupHab = {};
  checkins?.forEach(c => {
    const k = c.habitaciones?.numero||'?';
    if (!groupHab[k]) groupHab[k] = { numero:k, categoria:c.habitaciones?.categoria, noches:0, total:0 };
    if (c.check_out_real) {
      const dias = Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24));
      groupHab[k].noches += dias;
    }
    groupHab[k].total += c.total_cobrado||0;
  });
  document.getElementById('reporte-habitaciones').innerHTML = Object.values(groupHab).length
    ? Object.values(groupHab).map(h=>`<tr><td>Hab. ${String(h.numero).padStart(3,'0')} (${h.categoria})</td><td>${h.noches}</td><td>S/. ${h.total.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin datos</td></tr>';

  // Agrupar ventas por producto (de ventas públicas + consumos)
  const groupProd = {};
  ventas?.forEach(v => {
    try {
      const lineas = JSON.parse(v.lineas_json||'[]');
      lineas.forEach(l => {
        if (!groupProd[l.nombre]) groupProd[l.nombre] = { nombre:l.nombre, cantidad:0, total:0 };
        groupProd[l.nombre].cantidad += l.cantidad;
        groupProd[l.nombre].total    += l.subtotal||0;
      });
    } catch(e) {
      // Si no tiene lineas_json, usar el total de la venta
      if (!groupProd['Venta varios']) groupProd['Venta varios'] = { nombre:'Venta varios', cantidad:0, total:0 };
      groupProd['Venta varios'].cantidad++;
      groupProd['Venta varios'].total += v.total||0;
    }
  });
  // También agregar consumos de habitación
  consumosHab?.forEach(c => {
    const nombre = c.productos?.nombre||'Producto';
    if (!groupProd[nombre]) groupProd[nombre] = { nombre, cantidad:0, total:0 };
    groupProd[nombre].cantidad += c.cantidad;
    groupProd[nombre].total    += c.precio_total||0;
  });

  document.getElementById('reporte-ventas').innerHTML = Object.values(groupProd).length
    ? Object.values(groupProd).map(p=>`<tr><td>${p.nombre}</td><td>${p.cantidad}</td><td>S/. ${p.total.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin ventas en el período</td></tr>';

  // Detalle checkins
  document.getElementById('reporte-checkins').innerHTML = checkins?.length
    ? checkins.map(c => {
        const noches = c.check_out_real
          ? Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24)) : '—';
        return `<tr>
          <td>${String(c.habitaciones?.numero||'?').padStart(3,'0')}</td>
          <td>${c.clientes?.nombre||c.nombre_huesped}</td>
          <td>${formatDate(c.check_in_fecha)}</td>
          <td>${c.check_out_real?formatDate(c.check_out_real):'<span class="badge badge-verde">Activo</span>'}</td>
          <td>${noches}</td>
          <td>S/. ${((noches||0)*(c.precio_noche||0)).toFixed(2)}</td>
          <td>${c.metodo_pago||'—'}</td>
          <td>S/. ${c.total_cobrado?.toFixed(2)||'—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="empty-row">Sin datos en el período</td></tr>';
}

// ══════════════════════════════════════════════════════════
//  CLIENTES
// ══════════════════════════════════════════════════════════
async function loadClientes() {
  const q = document.getElementById('search-cliente')?.value.toLowerCase()||'';
  let query = sb.from('clientes').select('*').order('nombre');
  if (q) query = query.or(`nombre.ilike.%${q}%,dni.ilike.%${q}%`);
  const { data:clientes } = await query;

  document.getElementById('clientes-table').innerHTML = clientes?.length
    ? clientes.map(c=>`
        <tr>
          <td><strong>${c.nombre}</strong></td>
          <td>${c.dni||'—'}</td>
          <td>${c.telefono||'—'}</td>
          <td>${c.email||'—'}</td>
          <td>${c.ultima_estancia?formatDate(c.ultima_estancia):'—'}</td>
          <td>—</td>
          <td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editCliente(${c.id})">Editar</button></td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty-row">No se encontraron clientes</td></tr>';

  const inp = document.getElementById('search-cliente');
  if (inp && !inp._bound) { inp._bound=true; inp.addEventListener('input', loadClientes); }

  const btnAdd = document.getElementById('btn-add-cliente');
  if (btnAdd) btnAdd.onclick = () => {
    document.getElementById('cli-id').value='';
    document.getElementById('modal-cli-title').textContent='Nuevo cliente';
    ['cli-nombre','cli-dni','cli-tel','cli-email','cli-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    openModal('modal-cliente');
  };
}

async function editCliente(id) {
  const { data:c } = await sb.from('clientes').select('*').eq('id',id).single();
  document.getElementById('cli-id').value               = id;
  document.getElementById('modal-cli-title').textContent= 'Editar cliente';
  document.getElementById('cli-nombre').value           = c.nombre||'';
  document.getElementById('cli-dni').value              = c.dni||'';
  document.getElementById('cli-tel').value              = c.telefono||'';
  document.getElementById('cli-email').value            = c.email||'';
  document.getElementById('cli-obs').value              = c.observaciones||'';
  openModal('modal-cliente');
}

document.getElementById('btn-guardar-cliente')?.addEventListener('click', async () => {
  const id = document.getElementById('cli-id').value;
  const data = {
    nombre:       document.getElementById('cli-nombre').value.trim(),
    dni:          document.getElementById('cli-dni').value.trim(),
    telefono:     document.getElementById('cli-tel').value.trim(),
    email:        document.getElementById('cli-email').value.trim(),
    observaciones:document.getElementById('cli-obs').value.trim(),
  };
  if (!data.nombre) { showToast('El nombre es obligatorio','err'); return; }
  if (id) await sb.from('clientes').update(data).eq('id',id);
  else    await sb.from('clientes').insert(data);
  showToast('Cliente guardado ✓','ok');
  closeModal('modal-cliente');
  loadClientes();
});

// ══════════════════════════════════════════════════════════
//  USUARIOS — CORREGIDO (crea usuario en Auth + tabla)
// ══════════════════════════════════════════════════════════
async function loadUsuarios() {
  const { data:users } = await sb.from('usuarios').select('*').order('nombre');
  document.getElementById('users-table').innerHTML = users?.length
    ? users.map(u=>`
        <tr>
          <td><strong>${u.nombre}</strong></td>
          <td>${u.email||'—'}</td>
          <td><span class="badge badge-gold">${rolLabel(u.rol)}</span></td>
          <td><span class="badge ${u.activo?'badge-verde':'badge-rojo'}">${u.activo?'Activo':'Inactivo'}</span></td>
          <td>${u.ultimo_acceso?formatDate(u.ultimo_acceso):'Nunca'}</td>
          <td>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editUsuario(${u.id})">Editar rol</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleUsuario(${u.id},${!u.activo})">${u.activo?'Desactivar':'Activar'}</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="empty-row">No hay usuarios registrados</td></tr>';

  const btnAdd = document.getElementById('btn-add-user');
  if (btnAdd) btnAdd.onclick = () => {
    document.getElementById('usr-id').value='';
    ['usr-nombre','usr-email','usr-password'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('usr-rol').value='recepcionista';
    document.getElementById('modal-usuario-title').textContent='Nuevo usuario';
    document.getElementById('usr-password-group').style.display='block';
    openModal('modal-usuario');
  };
}

async function editUsuario(id) {
  const { data:u } = await sb.from('usuarios').select('*').eq('id',id).single();
  document.getElementById('usr-id').value               = id;
  document.getElementById('modal-usuario-title').textContent = 'Editar usuario';
  document.getElementById('usr-nombre').value           = u.nombre||'';
  document.getElementById('usr-email').value            = u.email||'';
  document.getElementById('usr-rol').value              = u.rol||'recepcionista';
  document.getElementById('usr-password-group').style.display = 'none'; // Al editar no se cambia password
  openModal('modal-usuario');
}

async function toggleUsuario(id, estado) {
  await sb.from('usuarios').update({ activo:estado }).eq('id',id);
  showToast('Usuario actualizado','ok'); loadUsuarios();
}

function setupModalUsuario() {
  const btn = document.getElementById('btn-guardar-usuario');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const id       = document.getElementById('usr-id').value;
    const nombre   = document.getElementById('usr-nombre').value.trim();
    const email    = document.getElementById('usr-email').value.trim();
    const password = document.getElementById('usr-password').value;
    const rol      = document.getElementById('usr-rol').value;

    if (!nombre||!email) { showToast('Nombre y email son obligatorios','err'); return; }

    if (id) {
      // Solo actualizar rol y nombre
      await sb.from('usuarios').update({ nombre, rol }).eq('id', id);
      showToast('Usuario actualizado ✓','ok');
    } else {
      // Crear nuevo usuario: primero en Auth, luego en tabla
      if (!password || password.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres','err'); return; }
      btn.disabled = true;
      btn.textContent = 'Creando...';

      const { data: authData, error: authErr } = await sb.auth.admin?.createUser({
        email, password,
        user_metadata: { nombre, rol },
        email_confirm: true,
      }) || {};

      // Si no hay admin API, intentar con signUp y luego actualizar
      let authId = authData?.user?.id;

      if (authErr || !authId) {
        // Fallback: crear via invitación (solo funciona si tienes habilitado inviteUserByEmail)
        const { data: invData, error: invErr } = await sb.auth.admin?.inviteUserByEmail(email, {
          data: { nombre, rol }
        }) || {};
        authId = invData?.user?.id;

        if (invErr || !authId) {
          showToast('Para crear usuarios, hazlo desde Supabase Dashboard → Authentication → Add user, luego asigna el rol aquí.','err');
          btn.disabled = false;
          btn.textContent = 'Guardar usuario';
          return;
        }
      }

      // Insertar en tabla usuarios
      const { error: dbErr } = await sb.from('usuarios').upsert({
        auth_id: authId, nombre, email, rol, activo: true
      }, { onConflict: 'email' });

      if (dbErr) { showToast('Error al registrar en base de datos','err'); btn.disabled=false; btn.textContent='Guardar usuario'; return; }
      showToast('✅ Usuario creado. Puede iniciar sesión con su contraseña.','ok');
      btn.disabled = false;
      btn.textContent = 'Guardar usuario';
    }

    closeModal('modal-usuario');
    loadUsuarios();
  });
}

// ══════════════════════════════════════════════════════════
//  MODALES & UTILS
// ══════════════════════════════════════════════════════════
function setupModals() {
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal || btn.closest('.sys-modal')?.id;
      if (modalId) closeModal(modalId);
    });
  });
  document.querySelectorAll('.sys-modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target===modal) closeModal(modal.id); });
  });
}

function openModal(id)  { const m=document.getElementById(id); if(m) m.style.display='flex'; }
function closeModal(id) { const m=document.getElementById(id); if(m) m.style.display='none'; }

function showToast(msg, type='ok') {
  const t = document.getElementById('sys-toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = `sys-toast toast-${type}`;
  t.style.display='block';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.display='none'; }, 4000);
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function formatTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
}
function escStr(str) { return (str||'').replace(/'/g,"\\'"); }
