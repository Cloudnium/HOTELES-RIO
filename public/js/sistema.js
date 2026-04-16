// ============================================================
//  sistema.js — Sistema de Gestión Interna Hoteles Rio v5
// ============================================================

const SUPABASE_URL      = 'https://fqxhrpimdskvfnupjhxs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxeGhycGltZHNrdmZudXBqaHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyOTQ0MTksImV4cCI6MjA5MTg3MDQxOX0.08VbFHp6m5s3E5LniyMwEm61eamIM03hdIHx-gQ4jJs';

const { createClient } = supabase;
// persistSession:true garantiza que la sesión sobrevive cambios de pestaña/ventana
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

let currentUser        = null;
let currentUserProfile = null;
let cajaActual         = null;
let carritoPublico     = {};
let stockOp            = '+';

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setDateBadge();
  setupLoginForm();
  setupNavigation();
  setupModals();
  setupModalUsuario();
  setupModalProducto();

  // Intentar recuperar sesión guardada
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await handleLogin(session.user);
  }

  // Escuchar cambios: SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT
  sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
      if (!currentUser) await handleLogin(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null; currentUserProfile = null; cajaActual = null;
      showLogin();
    }
  });
});

// Peru = UTC-5 fijo (sin horario de verano)
function fechaPeruHoy() {
  const now = new Date();
  const local = new Date(now.getTime() + (-5*60 - now.getTimezoneOffset()) * 60000);
  return local.toISOString().substring(0, 10);
}
function ahoraPeruISO() {
  const now = new Date();
  return new Date(now.getTime() + (-5*60 - now.getTimezoneOffset()) * 60000).toISOString();
}
function setDateBadge() {
  const hoy = fechaPeruHoy();
  const el = document.getElementById('sys-date-badge');
  if (el) el.textContent = new Date(hoy+'T12:00:00').toLocaleDateString('es-PE',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const cf = document.getElementById('caja-fecha');
  if (cf) cf.textContent = new Date(hoy+'T12:00:00').toLocaleDateString('es-PE');
}

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
function setupLoginForm() {
  const btn    = document.getElementById('login-btn');
  const emailIn= document.getElementById('login-email');
  const passIn = document.getElementById('login-pass');
  btn?.addEventListener('click', async () => {
    const email = emailIn.value.trim(), pass = passIn.value;
    if (!email||!pass) { showLoginError('Completa todos los campos'); return; }
    btn.disabled=true;
    document.getElementById('login-btn-text').style.display='none';
    document.getElementById('login-spinner').style.display='block';
    const { error } = await sb.auth.signInWithPassword({ email, password:pass });
    if (error) {
      showLoginError('Credenciales incorrectas.');
      btn.disabled=false;
      document.getElementById('login-btn-text').style.display='block';
      document.getElementById('login-spinner').style.display='none';
    }
  });
  passIn?.addEventListener('keydown', e => { if(e.key==='Enter') btn?.click(); });
}

function showLoginError(msg) {
  const el=document.getElementById('login-error');
  if(el){el.textContent=msg;el.style.display='block';}
}

async function handleLogin(user) {
  currentUser = user;
  let { data: profile } = await sb.from('usuarios').select('*').eq('auth_id', user.id).single();
  if (!profile) {
    const { data:p } = await sb.from('usuarios').insert({
      auth_id:user.id, email:user.email,
      nombre:user.user_metadata?.nombre||user.email.split('@')[0],
      rol:user.user_metadata?.rol||'recepcionista'
    }).select().single();
    profile = p;
  }
  currentUserProfile = profile;

  const name = profile?.nombre||user.email.split('@')[0];
  const role = profile?.rol||'recepcionista';
  document.getElementById('sys-user-name').textContent  = name;
  document.getElementById('sys-user-role').textContent  = rolLabel(role);
  document.getElementById('sys-avatar').textContent     = name.charAt(0).toUpperCase();

  if (role==='limpieza') {
    document.querySelectorAll('.sys-nav-item').forEach(item => {
      if(item.dataset.sec!=='habitaciones') item.style.display='none';
    });
  }
  if (role!=='admin') {
    document.querySelectorAll('[data-sec="usuarios"]').forEach(el=>el.style.display='none');
  }

  // Recuperar caja activa del usuario
  await recuperarCajaActiva();

  actualizarCajaStatus();
  showDashboard();
  loadSection('habitaciones');
  initNotificaciones();
}

// Recuperar caja activa persistida
async function recuperarCajaActiva() {
  const hoy = fechaPeruHoy();
  const { data:cajas } = await sb.from('cajas')
    .select('*').eq('fecha', hoy).eq('estado', 'abierta')
    .eq('usuario_id', currentUserProfile.id);
  cajaActual = cajas?.[0] || null;
}

function actualizarCajaStatus() {
  const el = document.getElementById('caja-status-topbar');
  const txt = document.getElementById('caja-status-text');
  if (!el || !txt) return;
  if (cajaActual) {
    el.className = 'caja-status-topbar abierta';
    txt.textContent = `Caja abierta`;
  } else {
    el.className = 'caja-status-topbar cerrada';
    txt.textContent = 'Sin caja abierta';
  }
}

function rolLabel(r){ return {admin:'Administrador',recepcionista:'Recepcionista',cajero:'Cajero',limpieza:'Limpieza'}[r]||r; }

document.getElementById('sys-logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

function showLogin() {
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('dashboard').style.display='none';
}
function showDashboard() {
  document.getElementById('login-screen').style.display='none';
  document.getElementById('dashboard').style.display='flex';
}

// ══════════════════════════════════════════════════════════
//  GUARD: requiere caja abierta
// ══════════════════════════════════════════════════════════
function requireCaja(accion) {
  if (cajaActual) return true;
  showToast(`⚠️ Debes abrir tu caja antes de ${accion}. Ve a Finanzas → Cajas del Día.`, 'err');
  return false;
}

// ══════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.sys-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sec=item.dataset.sec; if(!sec) return;
      document.querySelectorAll('.sys-nav-item').forEach(i=>i.classList.remove('active'));
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
  habitaciones:'Habitaciones','reservas-web':'Reservas Web',
  'tienda-hab':'Tienda por Habitación','tienda-publica':'Tienda Pública',
  almacen:'Almacén',cajas:'Cajas del Día',reportes:'Reportes',
  comprobantes:'Comprobantes',clientes:'Clientes',
  comentarios:'Comentarios Web',usuarios:'Usuarios'
};

function loadSection(sec) {
  document.querySelectorAll('.sys-section').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(`sec-${sec}`);
  if(el) el.classList.add('active');
  document.getElementById('sys-section-title').textContent=sectionTitles[sec]||sec;
  const loaders={
    habitaciones:loadHabitaciones,'reservas-web':loadReservasWeb,
    'tienda-hab':loadTiendaHab,'tienda-publica':loadTiendaPublica,
    almacen:loadAlmacen,cajas:loadCajas,reportes:initReportes,
    comprobantes:loadComprobantes,clientes:loadClientes,
    comentarios:loadComentarios,usuarios:loadUsuarios
  };
  loaders[sec]?.();
}

// ══════════════════════════════════════════════════════════
//  SERIE CORRELATIVA  T001-XXXXXXXX / T002-XXXXXXXX / T003-XXXXXXXX
// ══════════════════════════════════════════════════════════
async function getSiguienteSerie(tipo) {
  const prefix = { HAB:'T001', PUB:'T002', CAJA:'T003' }[tipo] || 'T001';
  const { count } = await sb.from('comprobantes')
    .select('*', { count:'exact', head:true }).eq('tipo_serie', tipo);
  return `${prefix}-${String((count||0)+1).padStart(8,'0')}`;
}

async function registrarComprobante({ serie, tipo, descripcion, cliente, total, metodo_pago, datos_json, check_in_id, venta_publica_id }) {
  await sb.from('comprobantes').insert({
    serie, tipo_serie:tipo, descripcion, cliente,
    total, metodo_pago, datos_json:JSON.stringify(datos_json||{}),
    check_in_id, venta_publica_id,
    usuario_id:currentUserProfile?.id,
    caja_id:cajaActual?.id,
  });
}

// ══════════════════════════════════════════════════════════
//  HABITACIONES — agrupadas por categoría
// ══════════════════════════════════════════════════════════
let _timerInterval = null;

function actualizarTimers() {
  document.querySelectorAll('[data-checkin-inicio]').forEach(el => {
    const inicio = new Date(el.dataset.checkinInicio);
    if(isNaN(inicio)) return;
    const diffMs = Date.now() - inicio.getTime();
    const totalSeg = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const txt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.textContent = `⏱ ${txt}`;
    el.className = 'room-timer ' + (h < 3 ? 'ok' : h < 4 ? 'warning' : 'exceeded');
  });
}

async function loadHabitaciones() {
  let query = sb.from('habitaciones').select('*').order('numero');
  const estado = document.getElementById('filter-estado')?.value;
  if(estado) query = query.eq('estado', estado);
  const { data:rooms } = await query;

  // Fetch active check-in timestamps for occupied rooms
  if (rooms?.length) {
    const ocupadasIds = rooms.filter(r=>r.estado==='ocupado').map(r=>r.id);
    if (ocupadasIds.length) {
      const { data:cis } = await sb.from('check_ins')
        .select('habitacion_id, created_at, check_in_fecha')
        .in('habitacion_id', ocupadasIds)
        .is('check_out_real', null);
      cis?.forEach(ci => {
        const rm = rooms.find(r=>r.id===ci.habitacion_id);
        if (rm) rm._checkin_ts = ci.created_at || (ci.check_in_fecha + 'T00:00:00Z');
      });
    }
  }

  renderRoomsGrid(rooms||[]);

  // Start/restart timer interval
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(actualizarTimers, 1000);
  actualizarTimers();

  const fe=document.getElementById('filter-estado');
  if(fe&&!fe._bound){fe._bound=true;fe.addEventListener('change',loadHabitaciones);}
  const fp=document.getElementById('filter-piso');
  if(fp) fp.style.display='none';
  // Admin button
  const adminBtn = document.getElementById('btn-nueva-hab-admin');
  if(adminBtn) adminBtn.style.display = currentUserProfile?.rol==='admin' ? 'inline-flex' : 'none';
}

const CATEGORIAS_ORDEN = ['economico','premium','suite'];
const CATEGORIA_LABELS = { economico:'Económico', premium:'Premium', suite:'Suite' };
const CATEGORIA_COLORS = { economico:'#2563eb', premium:'#7c3aed', suite:'#b45309' };

function renderRoomsGrid(rooms) {
  const grid=document.getElementById('rooms-grid');
  if(!grid) return;
  if(!rooms.length){grid.innerHTML='<p style="color:var(--text-light);padding:20px">No hay habitaciones.</p>';return;}

  // Agrupar por categoría
  const grupos = {};
  CATEGORIAS_ORDEN.forEach(c => grupos[c]=[]);
  rooms.forEach(r => {
    const cat = (r.categoria||'economico').toLowerCase();
    if(!grupos[cat]) grupos[cat]=[];
    grupos[cat].push(r);
  });

  let html = '';
  CATEGORIAS_ORDEN.forEach(cat => {
    const lista = grupos[cat];
    if(!lista||!lista.length) return;
    const color = CATEGORIA_COLORS[cat];
    html += `
      <div class="cat-group">
        <div class="cat-group-header" style="border-left-color:${color}">
          <span class="cat-group-label" style="color:${color}">${CATEGORIA_LABELS[cat]||cat}</span>
          <span class="cat-group-count">${lista.length} habitacion${lista.length!==1?'es':''}</span>
        </div>
        <div class="cat-rooms-grid">
          ${lista.map(r=>`
            <div class="room-card-sys status-${r.estado || 'disponible'}" onclick="openRoomModal(${r.id})">
              <div class="room-card-top">
                <div>
                  <div class="room-card-num">NRO: ${String(r.numero).padStart(3,'0')}</div>
                  <div class="room-card-cat">S/. ${r.precio_noche||0} x 4 horas</div>
                </div>
                <div class="room-card-icon">${roomIcon(r.estado)}</div>
              </div>
              ${r.estado==='ocupado' && r._checkin_ts ? `<div class="room-timer ok" data-checkin-inicio="${r._checkin_ts}">⏱ 00:00:00</div>` : ''}
              <div class="room-card-status status-${r.estado||'disponible'}">
                <span>${(r.estado||'DISPONIBLE').toUpperCase()}</span>
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  });
  grid.innerHTML = html;
}

function roomIcon(e){
  return {
    disponible:'<i class="fas fa-bed"></i>',
    ocupado:'<i class="fas fa-user-lock"></i>',
    limpieza:'<i class="fas fa-broom"></i>',
    mantenimiento:'<i class="fas fa-tools"></i>',
    reservado:'<i class="fas fa-calendar-check"></i>'
  }[e] || '<i class="fas fa-bed"></i>';
}

async function openRoomModal(id) {
  const { data:room } = await sb.from('habitaciones').select('*').eq('id',id).single();
  if(!room) return;
  const { data:checkins } = await sb.from('check_ins')
    .select('*, clientes(nombre)').eq('habitacion_id',id).is('check_out_real',null);
  const checkinActivo = checkins?.[0];
  document.getElementById('modal-hab-title').textContent=
    `Habitación ${String(room.numero).padStart(3,'0')} — ${CATEGORIA_LABELS[room.categoria]||room.categoria}`;
  const info=document.getElementById('modal-hab-info');
  const actions=document.getElementById('modal-hab-actions');
  info.innerHTML=`
    <h2>Habitación ${String(room.numero).padStart(3,'0')}</h2>
    <div class="modal-info-row"><span>Estado</span><span><span class="badge badge-${badgeColor(room.estado)}">${room.estado}</span></span></div>
    <div class="modal-info-row"><span>Categoría</span><span>${CATEGORIA_LABELS[room.categoria]||room.categoria}</span></div>
    <div class="modal-info-row"><span>Precio/4 horas</span><span>S/. ${room.precio_noche||'—'}</span></div>
    ${checkinActivo?`
      <div class="modal-info-row"><span>Huésped</span><span>${checkinActivo.clientes?.nombre||checkinActivo.nombre_huesped}</span></div>
      <div class="modal-info-row"><span>Check-in</span><span>${formatDate(checkinActivo.check_in_fecha)}</span></div>
      <div class="modal-info-row"><span>Salida est.</span><span>${formatDate(checkinActivo.check_out_estimado)}</span></div>
    `:''}`;
  actions.innerHTML='';

  if(room.estado==='disponible'||room.estado==='reservado') {
    addBtn(actions,'✅ Check-in','sys-btn-gold',()=>{
      if(!requireCaja('hacer check-in')) return;
      openCheckinModal(room); closeModal('modal-habitacion');
    });
  }
  if(room.estado==='ocupado'&&checkinActivo) {
    addBtn(actions,'🚪 Check-out','sys-btn-red',()=>{
      if(!requireCaja('hacer check-out')) return;
      openCheckoutModal(room,checkinActivo); closeModal('modal-habitacion');
    });
  }

  // Estados permitidos según rol:
  // Admin: todos. Otros: limpieza, disponible, mantenimiento, reservado (NO ocupado sin checkin)
  const isAdmin = currentUserProfile?.rol === 'admin';
  const estadosPermitidos = isAdmin
    ? ['disponible','ocupado','limpieza','mantenimiento','reservado']
    : ['disponible','limpieza','mantenimiento','reservado'];
  const estadosCambiables = estadosPermitidos.filter(e=>e!==room.estado);

  if (estadosCambiables.length > 0) {
    const ss=document.createElement('select'); ss.className='sys-select';
    ss.innerHTML=`<option value="">Cambiar estado...</option>`+estadosCambiables.map(e=>`<option value="${e}">${e}</option>`).join('');
    ss.addEventListener('change',async()=>{
      if(!ss.value) return;
      await sb.from('habitaciones').update({estado:ss.value}).eq('id',id);
      showToast('Estado actualizado','ok'); closeModal('modal-habitacion'); loadHabitaciones();
    });
    actions.appendChild(ss);
  }
  // Solo admin puede editar y eliminar habitaciones
  if(isAdmin){
    addBtn(actions,'✏️ Editar','sys-btn-outline',()=>{closeModal('modal-habitacion');editarHabitacion(id);});
    addBtn(actions,'🗑 Eliminar','sys-btn-red sys-btn-sm',()=>{closeModal('modal-habitacion');eliminarHabitacion(id);});
  }
  openModal('modal-habitacion');
}

function addBtn(c,t,cls,fn){const b=document.createElement('button');b.className=`sys-btn ${cls}`;b.innerHTML=t;b.addEventListener('click',fn);c.appendChild(b);}
function badgeColor(e){return{disponible:'verde',ocupado:'rojo',limpieza:'celeste',mantenimiento:'amarillo',reservado:'naranja'}[e]||'gold';}

// ── CHECK-IN ───────────────────────────────────────────────
function openCheckinModal(room) {
  document.getElementById('ci-hab-num').textContent=String(room.numero).padStart(3,'0');
  document.getElementById('ci-precio').value=room.precio_noche||'';
  const today=new Date().toISOString().split('T')[0];
  const manana=new Date(); manana.setDate(manana.getDate()+1);
  document.getElementById('ci-entrada').value=today;
  document.getElementById('ci-salida').value=manana.toISOString().split('T')[0];
  document.getElementById('btn-confirmar-checkin').onclick=()=>confirmarCheckin(room.id);
  openModal('modal-checkin');
}
async function confirmarCheckin(habId) {
  if(!requireCaja('hacer check-in')) return;
  const nombre=document.getElementById('ci-nombre').value.trim();
  const dni   =document.getElementById('ci-dni').value.trim();
  if(!nombre||!dni){showToast('Nombre y DNI son obligatorios','err');return;}
  let clienteId=null;
  const { data:ce } = await sb.from('clientes').select('id').eq('dni',dni).maybeSingle();
  if(ce){clienteId=ce.id;}
  else{
    const { data:nc } = await sb.from('clientes').insert({
      nombre,dni,telefono:document.getElementById('ci-tel').value,email:document.getElementById('ci-email').value
    }).select('id').single();
    clienteId=nc?.id;
  }
  await sb.from('check_ins').insert({
    habitacion_id:habId,cliente_id:clienteId,nombre_huesped:nombre,dni_huesped:dni,
    check_in_fecha:document.getElementById('ci-entrada').value,
    check_out_estimado:document.getElementById('ci-salida').value,
    num_huespedes:parseInt(document.getElementById('ci-huespedes').value)||1,
    precio_noche:parseFloat(document.getElementById('ci-precio').value)||0,
    observaciones:document.getElementById('ci-obs').value,
    usuario_id:currentUserProfile?.id,caja_id:cajaActual?.id,
  });
  await sb.from('habitaciones').update({estado:'ocupado'}).eq('id',habId);
  showToast('✅ Check-in registrado','ok');
  closeModal('modal-checkin'); loadHabitaciones();
}

// ── CHECK-OUT ──────────────────────────────────────────────
async function openCheckoutModal(room,checkin) {
  if(!requireCaja('hacer check-out')) return;
  document.getElementById('co-hab-num').textContent=String(room.numero).padStart(3,'0');
  const entrada=new Date(checkin.check_in_fecha),hoy=new Date();
  const noches=Math.max(1,Math.ceil((hoy-entrada)/(1000*60*60*24)));
  const totalHab=noches*(checkin.precio_noche||0);
  const { data:consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre)').eq('check_in_id',checkin.id).is('cobrado',false);
  const totalConsumos=consumos?.reduce((s,c)=>s+(c.precio_total||0),0)||0;
  const totalGeneral=totalHab+totalConsumos;
  const summary=document.getElementById('checkout-summary');
  summary.innerHTML=`
    <div class="checkout-row"><span>Huésped</span><span>${checkin.nombre_huesped}</span></div>
    <div class="checkout-row"><span>Noches</span><span>${noches}</span></div>
    <div class="checkout-row"><span>Precio x noche</span><span>S/. ${(checkin.precio_noche||0).toFixed(2)}</span></div>
    <div class="checkout-row"><span>Total habitación</span><span>S/. ${totalHab.toFixed(2)}</span></div>
    ${consumos?.map(c=>`<div class="checkout-row"><span>&nbsp;• ${c.productos?.nombre} x${c.cantidad}</span><span>S/. ${c.precio_total?.toFixed(2)}</span></div>`).join('')||''}
    <div class="checkout-row"><span>Consumos extras</span><span>S/. ${totalConsumos.toFixed(2)}</span></div>
    <div class="checkout-row checkout-total"><span>TOTAL A COBRAR</span><span>S/. ${totalGeneral.toFixed(2)}</span></div>
    <div class="pago-section">
      <div class="form-field"><label>Método de pago</label>
        <div class="metodo-pago-grid">
          <button class="metodo-btn active" data-metodo="Efectivo">💵 Efectivo</button>
          <button class="metodo-btn" data-metodo="Tarjeta">💳 Tarjeta</button>
          <button class="metodo-btn" data-metodo="Yape">📱 Yape</button>
          <button class="metodo-btn" data-metodo="Plin">📱 Plin</button>
        </div>
      </div>
      <div id="efectivo-section" class="efectivo-section">
        <div class="form-field"><label>Efectivo recibido (S/.)</label>
          <input type="number" id="efectivo-recibido" class="sys-input" step="0.01" value="${totalGeneral.toFixed(2)}">
        </div>
        <div class="vuelto-display">Vuelto: <strong id="vuelto-display">S/. 0.00</strong></div>
      </div>
    </div>`;
  let metodoPago='Efectivo';
  summary.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      summary.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); metodoPago=btn.dataset.metodo;
      document.getElementById('efectivo-section').style.display=metodoPago==='Efectivo'?'block':'none';
    });
  });
  document.getElementById('efectivo-recibido')?.addEventListener('input',e=>{
    const v=Math.max(0,parseFloat(e.target.value||0)-totalGeneral);
    const vd=document.getElementById('vuelto-display');
    vd.textContent=`S/. ${v.toFixed(2)}`; vd.style.color=v>0?'var(--gold)':'var(--text-mid)';
  });
  window._checkoutData={room,checkin,totalGeneral,consumos,totalHab,totalConsumos,noches,metodoPago:'Efectivo'};
  document.getElementById('btn-confirmar-checkout').onclick=async()=>{
    const metP=window._checkoutData.metodoPago||'Efectivo';
    const recibido=parseFloat(document.getElementById('efectivo-recibido')?.value)||totalGeneral;
    const vuelto=metP==='Efectivo'?Math.max(0,recibido-totalGeneral):0;
    window._checkoutData.vuelto=vuelto; window._checkoutData.metodoPago=metP;
    // Check 4h limit
    const ciTS=checkin.created_at||checkin.check_in_fecha+'T12:00:00';
    const horasUsadas=(new Date()-new Date(ciTS))/3600000;
    if(horasUsadas>4){
      closeModal('modal-checkout');
      const exceso=Math.max(0,horasUsadas-4).toFixed(1);
      document.getElementById('penalizacion-info').innerHTML=
        `⚠️ El huésped usó <strong>${horasUsadas.toFixed(1)} horas</strong> (límite 4h). Exceso: <strong>${exceso}h</strong>.`;
      document.getElementById('penalizacion-monto').value='';
      openModal('modal-penalizacion');
    } else {
      await confirmarCheckout(room,checkin,totalGeneral,consumos,metP,vuelto,noches,totalHab,totalConsumos,0);
    }
  };
  // Track metodo in realtime
  document.getElementById('checkout-summary')?.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{window._checkoutData.metodoPago=btn.dataset.metodo||'Efectivo';});
  });
  openModal('modal-checkout');
}
async function continuarCheckoutSinPen(){
  closeModal('modal-penalizacion');
  const d=window._checkoutData;
  await confirmarCheckout(d.room,d.checkin,d.totalGeneral,d.consumos,d.metodoPago,d.vuelto||0,d.noches,d.totalHab,d.totalConsumos,0);
}
async function continuarCheckoutConPen(){
  const pen=parseFloat(document.getElementById('penalizacion-monto').value)||0;
  closeModal('modal-penalizacion');
  const d=window._checkoutData;
  await confirmarCheckout(d.room,d.checkin,d.totalGeneral+pen,d.consumos,d.metodoPago,d.vuelto||0,d.noches,d.totalHab,d.totalConsumos,pen);
}

async function confirmarCheckout(room,checkin,total,consumos,metodoPago,vuelto,noches,totalHab,totalConsumos,penalizacion=0) {
  await sb.from('check_ins').update({check_out_real:new Date().toISOString(),total_cobrado:total,metodo_pago:metodoPago}).eq('id',checkin.id);
  await sb.from('habitaciones').update({estado:'limpieza'}).eq('id',room.id);
  if(consumos?.length) await sb.from('consumos_habitacion').update({cobrado:true}).in('id',consumos.map(c=>c.id));
  await sb.from('movimientos_caja').insert({
    caja_id:cajaActual.id,concepto:`Check-out Hab.${String(room.numero).padStart(3,'0')} (${metodoPago})`,
    tipo:'ingreso',monto:total,usuario_id:currentUserProfile?.id,
  });
  const serie=await getSiguienteSerie('HAB');
  const datosTicket={serie,room,checkin,consumos,total,metodoPago,vuelto,noches,totalHab,totalConsumos,cajero:currentUserProfile?.nombre||'—',fecha:new Date().toISOString()};
  await registrarComprobante({serie,tipo:'HAB',descripcion:`Hab.${String(room.numero).padStart(3,'0')} — ${room.categoria} — ${noches} noche(s)`,cliente:checkin.nombre_huesped,total,metodo_pago:metodoPago,datos_json:datosTicket,check_in_id:checkin.id});
  imprimirTicketHabitacion(datosTicket);
  showToast('🚪 Check-out completado','ok');
  closeModal('modal-checkout'); loadHabitaciones();
}

// ══════════════════════════════════════════════════════════
//  TICKETS IMPRESIÓN TÉRMICA 80mm
// ══════════════════════════════════════════════════════════
function abrirVentanaTicket(html) {
  const win=window.open('','_blank','width=420,height=740');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Ticket</title>
    <style>
      @page{size:80mm auto;margin:4mm}
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Courier New',Courier,monospace;font-size:11px;width:72mm;color:#000;background:#fff}
      .c{text-align:center}.b{font-weight:bold}.big{font-size:14px}.sm{font-size:9px}
      .ln{border-top:1px dashed #000;margin:4px 0}
      .logo{width:55mm;max-height:22mm;object-fit:contain;display:block;margin:0 auto 4px}
      table{width:100%;border-collapse:collapse}
      td{padding:1px 0;vertical-align:top}
      td.r{text-align:right;white-space:nowrap}
      .tr-total td{border-top:1px dashed #000;font-weight:bold;padding-top:3px}
      .hab-num{font-size:26px;font-weight:bold;text-align:center;letter-spacing:3px;margin:4px 0}
      .hab-cat{font-size:9px;text-align:center;letter-spacing:1px;text-transform:uppercase}
      .serie{font-size:10px;font-weight:bold;text-align:center;letter-spacing:1px;margin:3px 0}
      @media print{button{display:none!important}}
    </style>
  </head><body>
    ${html}
    <div style="text-align:center;margin-top:10px">
      <button onclick="window.print()" style="padding:8px 22px;font-size:13px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:4px;font-family:sans-serif">🖨 Imprimir</button>
    </div>
  </body></html>`);
  win.document.close();
}

function cabecera(serie) {
  const now=new Date();
  return `
    <div class="c">
      <img src="/images/logos/logo.png" class="logo" onerror="this.style.display='none'">
      <div class="b big">HOTELES RIO</div>
      <div class="sm">Au. Panamericana N 915, Sullana 20103</div>
      <div class="sm">Tel: +51 951-149-420</div>
    </div>
    <div class="ln"></div>
    <div class="c b">NOTA DE VENTA</div>
    <div class="serie">${serie}</div>
    <div class="ln"></div>
    <table>
      <tr><td>F. Emisión:</td><td class="r">${now.toLocaleDateString('es-PE')} ${now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td></tr>
      <tr><td>F. Vencimiento:</td><td class="r">${now.toLocaleDateString('es-PE')}</td></tr>
    </table>
    <div class="ln"></div>`;
}

function imprimirTicketHabitacion(d) {
  const consumosHTML=d.consumos?.length
    ?`<div class="ln"></div><div class="b sm">Consumos:</div><table>${d.consumos.map(c=>`<tr><td>${c.productos?.nombre||'—'}</td><td class="r">x${c.cantidad}</td><td class="r">S/.${c.precio_total?.toFixed(2)}</td></tr>`).join('')}</table>`:''
  const pagoHTML=d.metodoPago==='Efectivo'
    ?`<tr><td>Efectivo recibido:</td><td class="r">S/. ${(d.total+d.vuelto).toFixed(2)}</td></tr><tr><td>Vuelto:</td><td class="r">S/. ${d.vuelto.toFixed(2)}</td></tr>`:''
  abrirVentanaTicket(`
    ${cabecera(d.serie)}
    <div><span class="b">Cliente:</span> ${d.checkin.nombre_huesped}</div>
    <div><span class="b">DNI:</span> ${d.checkin.dni_huesped||'—'}</div>
    <div class="ln"></div>
    <table>
      <tr><td>Hab. — ${d.noches} noche(s)</td><td class="r">S/.${d.totalHab.toFixed(2)}</td></tr>
      <tr><td class="sm">&nbsp;Precio/4 horas: S/.${(d.checkin.precio_noche||0).toFixed(2)}</td><td></td></tr>
    </table>
    ${consumosHTML}
    <div class="ln"></div>
    <table><tr class="tr-total"><td class="b">TOTAL A PAGAR:</td><td class="r b">S/. ${d.total.toFixed(2)}</td></tr></table>
    <div class="ln"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${d.metodoPago}</td></tr>
      ${pagoHTML}
    </table>
    <div class="ln"></div>
    <div class="hab-num">${String(d.room.numero).padStart(3,'0')}</div>
    <div class="hab-cat">${(CATEGORIA_LABELS[d.room.categoria]||d.room.categoria||'').toUpperCase()}</div>
    <div class="ln"></div>
    <div class="c sm">Cajero: ${d.cajero}</div>
    <div class="c sm">¡Gracias por su visita! — Hoteles Rio</div>
    <br><br>`);
}

function imprimirTicketTienda(d) {
  const pagoHTML=d.metodoPago==='Efectivo'
    ?`<tr><td>Efectivo recibido:</td><td class="r">S/. ${(d.total+d.vuelto).toFixed(2)}</td></tr><tr><td>Vuelto:</td><td class="r">S/. ${d.vuelto.toFixed(2)}</td></tr>`:''
  abrirVentanaTicket(`
    ${cabecera(d.serie)}
    <div class="c b">VENTA AL PÚBLICO</div>
    <div class="ln"></div>
    <div><span class="b">Cajero:</span> ${d.cajero}</div>
    ${d.caja?`<div><span class="b">Caja:</span> ${d.caja}</div>`:''}
    <div class="ln"></div>
    <table>
      <tr><td class="b">Descripción</td><td class="r b">Cant.</td><td class="r b">Total</td></tr>
      ${d.items.map(([,i])=>`<tr><td>${i.nombre}</td><td class="r">x${i.cantidad}</td><td class="r">S/.${(i.precio*i.cantidad).toFixed(2)}</td></tr>`).join('')}
      <tr class="tr-total"><td colspan="2" class="b">TOTAL:</td><td class="r b">S/. ${d.total.toFixed(2)}</td></tr>
    </table>
    <div class="ln"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${d.metodoPago}</td></tr>
      ${pagoHTML}
    </table>
    <div class="ln"></div>
    <div class="c sm">¡Gracias por su compra! — Hoteles Rio</div>
    <br><br>`);
}

function imprimirTicketCaja(d) {
  // d: { serie, caja, usuario, fecha, movimientos, resumenMetodos, totalGeneral }
  const filasMov = d.movimientos.slice(0,30).map(m=>
    `<tr><td class="sm">${formatTime(m.created_at)}</td><td class="sm">${m.concepto?.substring(0,20)}</td><td class="r sm">${m.tipo==='ingreso'?'+':'-'}${m.monto?.toFixed(2)}</td></tr>`
  ).join('');
  const filasMetodos = Object.entries(d.resumenMetodos).map(([met,monto])=>
    `<tr><td>${met}</td><td class="r b">S/. ${monto.toFixed(2)}</td></tr>`
  ).join('');
  abrirVentanaTicket(`
    <div class="c">
      <img src="/images/logos/logo.png" class="logo" onerror="this.style.display='none'">
      <div class="b big">HOTELES RIO</div>
    </div>
    <div class="ln"></div>
    <div class="c b">RESUMEN DE CAJA</div>
    <div class="serie">${d.serie}</div>
    <div class="ln"></div>
    <table>
      <tr><td class="b">Caja:</td><td class="r">${d.caja}</td></tr>
      <tr><td class="b">Usuario:</td><td class="r">${d.usuario}</td></tr>
      <tr><td class="b">Fecha:</td><td class="r">${d.fecha}</td></tr>
      <tr><td class="b">Estado:</td><td class="r">${d.estado}</td></tr>
    </table>
    <div class="ln"></div>
    <div class="b sm">INGRESOS POR MÉTODO DE PAGO:</div>
    <table>${filasMetodos}</table>
    <div class="ln"></div>
    <table><tr class="tr-total"><td class="b">TOTAL CAJA:</td><td class="r b">S/. ${d.totalGeneral.toFixed(2)}</td></tr></table>
    <div class="ln"></div>
    <div class="b sm">DETALLE DE MOVIMIENTOS (${d.movimientos.length}):</div>
    <table>${filasMov}</table>
    ${d.movimientos.length>30?`<div class="c sm">... y ${d.movimientos.length-30} más</div>`:''}
    <div class="ln"></div>
    <div class="c sm">Impreso: ${new Date().toLocaleString('es-PE')}</div>
    <br><br>`);
}

function reimprimirComprobante(comp) {
  try {
    const d=typeof comp.datos_json==='string'?JSON.parse(comp.datos_json):comp.datos_json;
    if(comp.tipo_serie==='HAB') imprimirTicketHabitacion(d);
    else if(comp.tipo_serie==='PUB') imprimirTicketTienda(d);
    else if(comp.tipo_serie==='CAJA') imprimirTicketCaja(d);
  } catch(e){ showToast('No se puede reimprimir','err'); }
}

// ══════════════════════════════════════════════════════════
//  TIENDA POR HABITACIÓN
// ══════════════════════════════════════════════════════════
async function loadTiendaHab() {
  if(!requireCaja('vender productos')) return;
  const { data:ocupadas } = await sb.from('habitaciones').select('numero,id').eq('estado','ocupado').order('numero');
  const ids=ocupadas?.map(h=>h.id)||[];
  let checkinMap={};
  if(ids.length){
    const { data:cis } = await sb.from('check_ins').select('habitacion_id,id,nombre_huesped').in('habitacion_id',ids).is('check_out_real',null);
    cis?.forEach(c=>{checkinMap[c.habitacion_id]=c;});
  }
  const sel=document.getElementById('sel-hab-tienda');
  if(sel){
    sel.innerHTML='<option value="">Seleccionar habitación ocupada...</option>'+(ocupadas||[]).map(h=>{
      const ci=checkinMap[h.id];
      return `<option value="${h.id}" data-checkin="${ci?.id||''}">${String(h.numero).padStart(3,'0')} — ${ci?.nombre_huesped||'Huésped'}</option>`;
    }).join('');
    if(!sel._bound){sel._bound=true;sel.addEventListener('change',loadConsumosHab);}
  }
  loadProductsQuick('products-quick',false);
}
async function loadConsumosHab() {
  const sel=document.getElementById('sel-hab-tienda');
  const checkinId=sel?.options[sel.selectedIndex]?.dataset.checkin;
  if(!checkinId) return;
  const { data:consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre,precio_venta)').eq('check_in_id',checkinId).is('cobrado',false)
    .order('created_at',{ascending:false});
  const tbody=document.getElementById('consumos-hab-list');
  const total=consumos?.reduce((s,c)=>s+(c.precio_total||0),0)||0;
  tbody.innerHTML=consumos?.length
    ?consumos.map(c=>`<tr><td>${c.productos?.nombre||'—'}</td><td>${c.cantidad}</td><td>S/. ${c.precio_unitario?.toFixed(2)}</td><td>S/. ${c.precio_total?.toFixed(2)}</td><td>${formatTime(c.created_at)}</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="eliminarConsumo(${c.id})">✕</button></td></tr>`).join('')
    :'<tr><td colspan="6" class="empty-row">Sin consumos</td></tr>';
  document.getElementById('total-consumos-hab').textContent=`S/. ${total.toFixed(2)}`;
}
async function agregarConsumoHab(productoId,nombre,precio) {
  if(!requireCaja('agregar consumos')) return;
  const sel=document.getElementById('sel-hab-tienda');
  const checkinId=sel?.options[sel.selectedIndex]?.dataset.checkin;
  if(!checkinId){showToast('Selecciona una habitación primero','err');return;}
  await sb.from('consumos_habitacion').insert({check_in_id:checkinId,producto_id:productoId,cantidad:1,precio_unitario:precio,precio_total:precio,usuario_id:currentUserProfile?.id});
  await sb.rpc('descontar_stock',{p_producto_id:productoId,p_cantidad:1});
  showToast(`+1 ${nombre}`,'ok'); loadConsumosHab();
}
async function eliminarConsumo(id){
  await sb.from('consumos_habitacion').delete().eq('id',id);
  showToast('Eliminado','ok'); loadConsumosHab();
}

// ══════════════════════════════════════════════════════════
//  TIENDA PÚBLICA — Catálogo + Carrito
// ══════════════════════════════════════════════════════════
async function loadTiendaPublica() {
  if(!requireCaja('vender en tienda')) return;
  carritoPublico={};
  await cargarCatalogoPub();
  await loadVentasHoy();
  renderCarrito();

  const inp=document.getElementById('search-product-pub');
  const catSel=document.getElementById('filter-cat-pub');
  const filtrar=()=>{
    const q=(inp?.value||'').toLowerCase();
    const cat=catSel?.value||'';
    document.querySelectorAll('#products-catalog .prod-card').forEach(card=>{
      const name=card.dataset.name||'';
      const cardCat=card.dataset.cat||'';
      const matchQ=!q||name.includes(q);
      const matchC=!cat||cardCat===cat;
      card.style.display=(matchQ&&matchC)?'':'none';
    });
  };
  if(inp&&!inp._bound){inp._bound=true;inp.addEventListener('input',filtrar);}
  if(catSel&&!catSel._bound){catSel._bound=true;catSel.addEventListener('change',filtrar);}

  const btnN=document.getElementById('btn-nueva-venta-pub');
  if(btnN){btnN.onclick=()=>limpiarCarrito();}
  const btnLimpiar=document.getElementById('btn-limpiar-carrito');
  if(btnLimpiar){btnLimpiar.onclick=()=>limpiarCarrito();}
  const btnConf=document.getElementById('btn-confirmar-venta-pub');
  if(btnConf){btnConf.onclick=abrirModalPagoPub;}
}

function limpiarCarrito(){
  carritoPublico={};
  document.querySelectorAll('#products-catalog .prod-card').forEach(c=>{
    c.classList.remove('in-cart');
    const badge=c.querySelector('.prod-qty-badge');
    if(badge) badge.textContent='0';
  });
  renderCarrito();
}

async function cargarCatalogoPub(){
  const { data:prods } = await sb.from('productos').select('*').eq('activo',true).order('nombre');
  const container=document.getElementById('products-catalog'); if(!container) return;
  const EMOJIS={bebidas:'🥤',snacks:'🍿',higiene:'🧴',servicios:'🛎️',otros:'📦'};
  container.innerHTML=prods?.length
    ?prods.map(p=>`
        <div class="prod-card ${p.stock<=0?'no-stock':''}"
             data-name="${escStr((p.nombre||'').toLowerCase())}" data-cat="${p.categoria||''}"
             onclick="${p.stock>0?`addToCarritoPub(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`:''}">
          <span class="prod-emoji">${EMOJIS[p.categoria]||'📦'}</span>
          <div class="prod-name">${p.nombre}</div>
          <div class="prod-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="prod-stock">${p.stock<=0?'Sin stock':'Stock: '+p.stock}</div>
          <div class="prod-qty-badge" id="badge-${p.id}">0</div>
        </div>`).join('')
    :'<p style="padding:20px;color:var(--text-3)">No hay productos en almacén.</p>';
  // Inicializar contador
  const hoyCount=document.getElementById('ventas-hoy-count');
  if(hoyCount){
    const hoy=new Date().toISOString().split('T')[0];
    const { count } = await sb.from('ventas_publicas').select('*',{count:'exact',head:true}).gte('created_at',hoy+'T00:00:00');
    hoyCount.textContent=`${count||0} venta${(count||0)!==1?'s':''} hoy`;
  }
}

function addToCarritoPub(prodId,nombre,precio){
  if(!requireCaja('vender')) return;
  if(!carritoPublico[prodId]) carritoPublico[prodId]={nombre,precio,cantidad:0};
  carritoPublico[prodId].cantidad++;
  const badge=document.getElementById(`badge-${prodId}`);
  if(badge) badge.textContent=carritoPublico[prodId].cantidad;
  const card=badge?.closest('.prod-card');
  if(card) card.classList.add('in-cart');
  renderCarrito();
}

function addToCarritoPublico(prodId,nombre,precio){ addToCarritoPub(prodId,nombre,precio); }

function cambiarCantidad(prodId,delta){
  if(!carritoPublico[prodId]) return;
  carritoPublico[prodId].cantidad=Math.max(0,carritoPublico[prodId].cantidad+delta);
  const badge=document.getElementById(`badge-${prodId}`);
  if(badge) badge.textContent=carritoPublico[prodId].cantidad;
  const card=badge?.closest('.prod-card');
  if(carritoPublico[prodId].cantidad===0){
    delete carritoPublico[prodId];
    if(card) card.classList.remove('in-cart');
  } else if(card) card.classList.add('in-cart');
  renderCarrito();
}

function renderCarrito(){
  const items=Object.entries(carritoPublico).filter(([,i])=>i.cantidad>0);
  const total=items.reduce((s,[,i])=>s+i.precio*i.cantidad,0);
  const count=items.reduce((s,[,i])=>s+i.cantidad,0);

  const cBadge=document.getElementById('carrito-count');
  if(cBadge) cBadge.textContent=count;
  const cTotal=document.getElementById('carrito-total');
  if(cTotal) cTotal.textContent=`S/. ${total.toFixed(2)}`;

  const cItems=document.getElementById('carrito-items'); if(!cItems) return;
  if(!items.length){
    cItems.innerHTML=`<div class="carrito-empty"><i class="fas fa-shopping-basket"></i><p style="font-size:13px;font-weight:500;color:var(--text-2)">Carrito vacío</p><p style="font-size:11px;color:var(--text-3);margin-top:4px">Haz clic en un producto</p></div>`;
    return;
  }
  cItems.innerHTML=items.map(([id,i])=>`
    <div class="carrito-item">
      <div class="carrito-item-info">
        <div class="carrito-item-name">${i.nombre}</div>
        <div class="carrito-item-price">S/. ${i.precio.toFixed(2)} c/u — <strong>S/. ${(i.precio*i.cantidad).toFixed(2)}</strong></div>
      </div>
      <div class="carrito-item-controls">
        <button class="qty-btn" onclick="cambiarCantidad(${id},-1)">−</button>
        <span class="qty-num">${i.cantidad}</span>
        <button class="qty-btn" onclick="cambiarCantidad(${id},+1)">+</button>
      </div>
    </div>`).join('');
}

async function loadVentasHoy() {
  const hoy=fechaPeruHoy();
  const { data:ventas } = await sb.from('ventas_publicas').select('*, usuarios(nombre)').gte('created_at',hoy+'T00:00:00').order('created_at',{ascending:false});
  const tbody=document.getElementById('ventas-pub-list'); if(!tbody) return;
  tbody.innerHTML=ventas?.length?ventas.map(v=>`<tr><td>${formatTime(v.created_at)}</td><td>${v.detalle||'—'}</td><td>S/. ${v.total?.toFixed(2)}</td><td>${v.usuarios?.nombre||'—'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">Sin ventas hoy</td></tr>';
}

function renderTotalPublico(){
  const total=Object.values(carritoPublico).reduce((s,i)=>s+i.precio*i.cantidad,0);
  const el=document.getElementById('total-pub-display'); if(el) el.textContent=`S/. ${total.toFixed(2)}`;
}
function abrirModalPagoPub(){
  if(!requireCaja('confirmar venta')) return;
  const items=Object.entries(carritoPublico).filter(([,i])=>i.cantidad>0);
  if(!items.length){showToast('Agrega productos al carrito primero','err');return;}
  const total=items.reduce((s,[,i])=>s+i.precio*i.cantidad,0);
  const modal=document.getElementById('modal-pago-pub'); if(!modal) return;
  document.getElementById('pago-pub-items').innerHTML=
    items.map(([,i])=>`<div class="checkout-row"><span>${i.nombre} x${i.cantidad}</span><span>S/. ${(i.precio*i.cantidad).toFixed(2)}</span></div>`).join('')+
    `<div class="checkout-row checkout-total"><span>TOTAL</span><span>S/. ${total.toFixed(2)}</span></div>`;
  let metodoPub='Efectivo';
  modal.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.classList.remove('active');
    if(btn.dataset.metodo==='Efectivo') btn.classList.add('active');
    btn.onclick=()=>{modal.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');metodoPub=btn.dataset.metodo;document.getElementById('efectivo-pub-section').style.display=metodoPub==='Efectivo'?'block':'none';};
  });
  const ef=document.getElementById('efectivo-pub-recibido');
  if(ef){ef.value=total.toFixed(2);ef.oninput=()=>{const v=Math.max(0,parseFloat(ef.value||0)-total);document.getElementById('vuelto-pub').textContent=`S/. ${v.toFixed(2)}`;};}
  document.getElementById('btn-confirmar-pago-pub').onclick=async()=>{
    const recibido=parseFloat(document.getElementById('efectivo-pub-recibido')?.value)||total;
    const vuelto=metodoPub==='Efectivo'?Math.max(0,recibido-total):0;
    await procesarVentaPublica(items,total,metodoPub,vuelto);
    closeModal('modal-pago-pub');
  };
  openModal('modal-pago-pub');
}
async function procesarVentaPublica(items,total,metodoPago,vuelto){
  const detalle=items.map(([,i])=>`${i.cantidad}x ${i.nombre}`).join(', ');
  const lineas=items.map(([,i])=>({nombre:i.nombre,cantidad:i.cantidad,precio_unit:i.precio,subtotal:i.precio*i.cantidad}));
  for(const [prodId,info] of items) await sb.rpc('descontar_stock',{p_producto_id:parseInt(prodId),p_cantidad:info.cantidad});
  const { data:venta } = await sb.from('ventas_publicas').insert({total,detalle,metodo_pago:metodoPago,lineas_json:JSON.stringify(lineas),usuario_id:currentUserProfile?.id,caja_id:cajaActual?.id}).select().single();
  await sb.from('movimientos_caja').insert({caja_id:cajaActual.id,concepto:`Venta pública: ${detalle}`,tipo:'ingreso',monto:total,usuario_id:currentUserProfile?.id});
  const serie=await getSiguienteSerie('PUB');
  const cajero=currentUserProfile?.nombre||'—';
  const cajaNombre=`Caja #${cajaActual.id}`;
  const datosTicket={serie,items,total,metodoPago,vuelto,cajero,caja:cajaNombre,fecha:new Date().toISOString()};
  await registrarComprobante({serie,tipo:'PUB',descripcion:detalle,cliente:'Cliente General',total,metodo_pago:metodoPago,datos_json:datosTicket,venta_publica_id:venta?.id});
  imprimirTicketTienda(datosTicket);
  carritoPublico={}; renderCarrito(); document.querySelectorAll('[id^="badge-"]').forEach(el=>{el.textContent='0';}); document.querySelectorAll('.prod-card').forEach(c=>c.classList.remove('in-cart'));
  showToast(`✅ Venta S/. ${total.toFixed(2)} registrada`,'ok'); await loadVentasHoy();
}

async function loadProductsQuick(containerId,isPublic=false){
  const { data:prods } = await sb.from('productos').select('*').eq('activo',true).order('nombre');
  const container=document.getElementById(containerId); if(!container) return;
  container.innerHTML=prods?.length
    ?prods.map(p=>`
        <div class="product-quick-card ${p.stock<=0?'no-stock':''}"
             onclick="${p.stock>0?(isPublic?`addToCarritoPublico(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`:`agregarConsumoHab(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`):''}">
          <div class="pq-name">${p.nombre}</div>
          <div class="pq-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="pq-stock">Stock: ${p.stock}</div>
          ${isPublic?`<div class="pq-carrito" id="carrito-${p.id}"></div>`:''}
        </div>`).join('')
    :'<p style="padding:16px;color:var(--text-light)">No hay productos.</p>';
}

// ══════════════════════════════════════════════════════════
//  ALMACÉN
// ══════════════════════════════════════════════════════════
async function loadAlmacen(){
  const { data:prods } = await sb.from('productos').select('*').order('nombre');
  const sinStock=prods?.filter(p=>p.stock<=0).length||0;
  const stockBajo=prods?.filter(p=>p.stock>0&&p.stock<=(p.stock_minimo||5)).length||0;
  document.getElementById('almacen-stats').innerHTML=`
    <div class="stat-card-sys"><p>Total productos</p><h3>${prods?.length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#dc2626"><p>Sin stock</p><h3>${sinStock}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#ca8a04"><p>Stock bajo</p><h3>${stockBajo}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Activos</p><h3>${prods?.filter(p=>p.activo).length||0}</h3></div>`;
  document.getElementById('products-table').innerHTML=prods?.length
    ?prods.map(p=>`<tr>
        <td>${p.codigo||'—'}</td><td><strong>${p.nombre}</strong></td><td>${p.categoria||'—'}</td>
        <td>S/. ${p.precio_venta?.toFixed(2)||'0.00'}</td><td><strong>${p.stock}</strong></td><td>${p.stock_minimo||5}</td>
        <td><span class="badge ${p.stock<=0?'badge-rojo':p.stock<=(p.stock_minimo||5)?'badge-amarillo':'badge-verde'}">${p.stock<=0?'Sin stock':p.stock<=(p.stock_minimo||5)?'Stock bajo':'OK'}</span></td>
        <td>${currentUserProfile?.rol==='admin'?`
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editProduct(${p.id})">Editar</button>
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleProduct(${p.id},${!p.activo})">${p.activo?'Desact.':'Activar'}</button>`
          :'<span style="font-size:11px;color:var(--text-3)">Solo admin</span>'}
        </td></tr>`).join('')
    :'<tr><td colspan="8" class="empty-row">No hay productos</td></tr>';
  const btnAdd=document.getElementById('btn-add-product');
  if(btnAdd){
    if(currentUserProfile?.rol!=='admin') btnAdd.style.display='none';
    else btnAdd.onclick=()=>{
    document.getElementById('prod-id').value='';
    document.getElementById('modal-prod-title').textContent='Nuevo producto';
    ['prod-nombre','prod-codigo','prod-precio-venta','prod-stock','prod-stock-min'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('stock-edit-section').style.display='none';
    document.getElementById('stock-nuevo-section').style.display='block';
    document.getElementById('prod-stock-ajuste').value='0';
    document.getElementById('stock-resultado-preview').textContent='';
    openModal('modal-producto');
  };
  }
}
async function editProduct(id){
  const { data:p } = await sb.from('productos').select('*').eq('id',id).single();
  document.getElementById('prod-id').value=id;
  document.getElementById('modal-prod-title').textContent='Editar producto';
  document.getElementById('prod-nombre').value=p.nombre||'';
  document.getElementById('prod-codigo').value=p.codigo||'';
  document.getElementById('prod-categoria').value=p.categoria||'otros';
  document.getElementById('prod-precio-venta').value=p.precio_venta||'';
  document.getElementById('prod-stock-min').value=p.stock_minimo||5;
  document.getElementById('stock-edit-section').style.display='block';
  document.getElementById('stock-nuevo-section').style.display='none';
  document.getElementById('prod-stock-actual').textContent=p.stock;
  document.getElementById('prod-stock-ajuste').value='0';
  stockOp='+';
  const btnS=document.getElementById('btn-stock-sumar');const btnR=document.getElementById('btn-stock-restar');
  if(btnS) btnS.style.cssText='background:var(--gold);color:var(--charcoal)';
  if(btnR) btnR.style.cssText='';
  actualizarPreviewStock(p.stock);
  openModal('modal-producto');
}
function actualizarPreviewStock(stockActual){
  const ajuste=parseInt(document.getElementById('prod-stock-ajuste')?.value)||0;
  const nuevo=stockOp==='+'?stockActual+ajuste:Math.max(0,stockActual-ajuste);
  const prev=document.getElementById('stock-resultado-preview');
  if(prev) prev.textContent=ajuste>0?`Stock resultante: ${nuevo} unidades`:'';
}
function setupModalProducto(){
  const btnS=document.getElementById('btn-stock-sumar');
  const btnR=document.getElementById('btn-stock-restar');
  const inp=document.getElementById('prod-stock-ajuste');
  btnS?.addEventListener('click',()=>{stockOp='+';btnS.style.cssText='background:var(--gold);color:var(--charcoal)';btnR.style.cssText='';actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0);});
  btnR?.addEventListener('click',()=>{stockOp='-';btnR.style.cssText='background:#dc2626;color:#fff';btnS.style.cssText='';actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0);});
  inp?.addEventListener('input',()=>actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0));
  document.getElementById('btn-guardar-producto')?.addEventListener('click',async()=>{
    const id=document.getElementById('prod-id').value;
    const nombre=document.getElementById('prod-nombre').value.trim();
    if(!nombre){showToast('El nombre es obligatorio','err');return;}
    const data={nombre,codigo:document.getElementById('prod-codigo').value.trim(),categoria:document.getElementById('prod-categoria').value,precio_venta:parseFloat(document.getElementById('prod-precio-venta').value)||0,stock_minimo:parseInt(document.getElementById('prod-stock-min').value)||5,activo:true};
    if(id){
      const { data:pA } = await sb.from('productos').select('stock').eq('id',id).single();
      const sA=pA?.stock||0;const aj=parseInt(inp.value)||0;
      data.stock=stockOp==='+'?sA+aj:Math.max(0,sA-aj);
      await sb.from('productos').update(data).eq('id',id);
    } else {
      data.stock=parseInt(document.getElementById('prod-stock').value)||0;
      await sb.from('productos').insert(data);
    }
    showToast('Producto guardado ✓','ok'); closeModal('modal-producto'); loadAlmacen();
  });
}
async function toggleProduct(id,estado){await sb.from('productos').update({activo:estado}).eq('id',id);showToast('Actualizado','ok');loadAlmacen();}

// ══════════════════════════════════════════════════════════
//  CAJAS — con histórico por fecha y ticket de cierre
// ══════════════════════════════════════════════════════════
async function loadCajas(){
  const hoy=new Date().toISOString().split('T')[0];
  // Inicializar filtro de fecha si no tiene valor
  const fecInput=document.getElementById('caja-hist-fecha');
  if(fecInput&&!fecInput.value) fecInput.value=hoy;
  const fechaFiltro=fecInput?.value||hoy;
  document.getElementById('caja-fecha').textContent=fechaFiltro;

  const { data:cajas } = await sb.from('cajas').select('*, usuarios(nombre)').eq('fecha',fechaFiltro).order('created_at');

  // Actualizar cajaActual si es hoy
  if(fechaFiltro===hoy) cajaActual=cajas?.find(c=>c.usuario_id===currentUserProfile?.id&&c.estado==='abierta')||cajaActual||null;

  const grid=document.getElementById('cajas-grid');
  grid.innerHTML=cajas?.length
    ?cajas.map(c=>`
        <div class="caja-card ${c.estado==='abierta'?'caja-abierta':'caja-cerrada'}">
          <h4>${c.usuarios?.nombre||'—'}</h4>
          <div class="caja-user">📅 ${c.fecha} | ${c.estado}</div>
          <div class="caja-total">S/. ${(c.total||0).toFixed(2)}</div>
          <div class="caja-sub">Apertura: ${formatTime(c.created_at)}</div>
          <div class="caja-actions">
            ${c.estado==='abierta'&&c.usuario_id===currentUserProfile?.id&&fechaFiltro===hoy
              ?`<button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cerrarCaja(${c.id})">Cerrar caja</button>`:''}
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="verDetalleCaja(${c.id})">Ver detalle</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="imprimirCaja(${c.id})">🖨 Ticket</button>
          </div>
        </div>`).join('')
    :'<p style="color:var(--text-light)">No hay cajas en esta fecha.</p>';

  const btnAbrir=document.getElementById('btn-abrir-caja');
  if(btnAbrir) btnAbrir.onclick=abrirCaja;

  // Bind filtro fecha
  if(fecInput&&!fecInput._bound){fecInput._bound=true;fecInput.addEventListener('change',loadCajas);}

  // Mostrar movimientos de la caja activa del usuario para HOY
  if(cajaActual&&fechaFiltro===hoy){
    const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaActual.id).order('created_at',{ascending:false});
    const tbody=document.getElementById('caja-movimientos');
    tbody.innerHTML=movs?.length
      ?movs.map(m=>`<tr><td>${formatTime(m.created_at)}</td><td>${m.concepto}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td><td>S/. ${m.monto?.toFixed(2)}</td></tr>`).join('')
      :'<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  }
}

async function verDetalleCaja(cajaId){
  const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaId).order('created_at',{ascending:false});
  const tbody=document.getElementById('caja-movimientos');
  tbody.innerHTML=movs?.length
    ?movs.map(m=>`<tr><td>${formatTime(m.created_at)}</td><td>${m.concepto}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td><td>S/. ${m.monto?.toFixed(2)}</td></tr>`).join('')
    :'<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  document.getElementById('caja-movimientos').scrollIntoView({behavior:'smooth'});
}

async function imprimirCaja(cajaId){
  const { data:caja } = await sb.from('cajas').select('*, usuarios(nombre)').eq('id',cajaId).single();
  const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaId).order('created_at',{ascending:false});

  // Calcular resumen por método de pago
  const resumenMetodos={};
  movs?.filter(m=>m.tipo==='ingreso').forEach(m=>{
    // Extraer método del concepto
    let met='Varios';
    if(m.concepto?.includes('Efectivo')) met='Efectivo';
    else if(m.concepto?.includes('Tarjeta')) met='Tarjeta';
    else if(m.concepto?.includes('Yape')) met='Yape';
    else if(m.concepto?.includes('Plin')) met='Plin';
    resumenMetodos[met]=(resumenMetodos[met]||0)+(m.monto||0);
  });

  const serie=await getSiguienteSerie('CAJA');
  const datosTicket={
    serie, caja:`#${cajaId}`, usuario:caja?.usuarios?.nombre||'—',
    fecha:caja?.fecha, estado:caja?.estado,
    movimientos:movs||[], resumenMetodos, totalGeneral:caja?.total||0
  };
  await registrarComprobante({serie,tipo:'CAJA',descripcion:`Resumen caja #${cajaId}`,cliente:'—',total:caja?.total||0,metodo_pago:'Varios',datos_json:datosTicket});
  imprimirTicketCaja(datosTicket);
}

async function abrirCaja(){
  if(cajaActual){showToast('Ya tienes una caja abierta','err');return;}
  const hoy=fechaPeruHoy();
  const { data } = await sb.from('cajas').insert({usuario_id:currentUserProfile?.id,fecha:hoy,estado:'abierta',total:0}).select().single();
  cajaActual=data; actualizarCajaStatus(); showToast('✅ Caja abierta','ok'); loadCajas();
}
async function cerrarCaja(id){
  await sb.from('cajas').update({estado:'cerrada'}).eq('id',id);
  if(cajaActual?.id===id) cajaActual=null;
  actualizarCajaStatus(); showToast('Caja cerrada ✓','ok'); loadCajas();
}

// ══════════════════════════════════════════════════════════
//  REPORTES
// ══════════════════════════════════════════════════════════
function initReportes(){
  const hoyStr=fechaPeruHoy();
  const hoyDate=new Date(hoyStr+'T12:00:00');
  const primer=new Date(hoyDate.getFullYear(),hoyDate.getMonth(),1).toISOString().split('T')[0];
  const desdEl=document.getElementById('reporte-desde');
  const hastaEl=document.getElementById('reporte-hasta');
  if(desdEl){desdEl.removeAttribute('max');desdEl.removeAttribute('min');if(!desdEl.value)desdEl.value=primer;}
  if(hastaEl){hastaEl.removeAttribute('max');hastaEl.removeAttribute('min');if(!hastaEl.value)hastaEl.value=hoyStr;}
  if(desdEl&&!desdEl._bound){desdEl._bound=true;desdEl.addEventListener('change',()=>{if(document.getElementById('reporte-hasta').value)generarReporte();});}
  if(hastaEl&&!hastaEl._bound){hastaEl._bound=true;hastaEl.addEventListener('change',()=>{if(document.getElementById('reporte-desde').value)generarReporte();});}
  generarReporte();
}
async function generarReporte(){
  const desde=document.getElementById('reporte-desde').value;
  const hasta=document.getElementById('reporte-hasta').value;
  if(!desde||!hasta){showToast('Selecciona el rango de fechas','err');return;}
  const desdeTS=desde+'T00:00:00',hastaTS=hasta+'T23:59:59';
  const { data:checkins } = await sb.from('check_ins').select('*, habitaciones(numero,categoria), clientes(nombre)').gte('check_in_fecha',desde).lte('check_in_fecha',hasta).order('check_in_fecha',{ascending:false});
  const { data:consumosHab } = await sb.from('consumos_habitacion').select('*, productos(nombre)').gte('created_at',desdeTS).lte('created_at',hastaTS);
  const { data:ventasPub } = await sb.from('ventas_publicas').select('*').gte('created_at',desdeTS).lte('created_at',hastaTS).order('created_at',{ascending:false});
  const totalHabTotal=checkins?.reduce((s,c)=>s+(c.total_cobrado||0),0)||0;
  const totalVentasPub=ventasPub?.reduce((s,v)=>s+(v.total||0),0)||0;
  // Resumen por método de pago
  const mMap={};
  checkins?.forEach(c=>{const m=c.metodo_pago||'Efectivo';mMap[m]=(mMap[m]||0)+(c.total_cobrado||0);});
  ventasPub?.forEach(v=>{const m=v.metodo_pago||'Efectivo';mMap[m]=(mMap[m]||0)+(v.total||0);});
  const mColors={Efectivo:'#10b981',Tarjeta:'#3b82f6',Yape:'#7c3aed',Plin:'#ec4899'};
  const mHTML=Object.entries(mMap).map(([m,v])=>
    `<div class="stat-card-sys" style="border-left-color:${mColors[m]||'#6b7280'}"><p>${m}</p><h3>S/. ${v.toFixed(2)}</h3><small>por método</small></div>`
  ).join('');
  document.getElementById('reporte-stats').innerHTML=`
    <div class="stat-card-sys"><p>Check-ins período</p><h3>${checkins?.length||0}</h3></div>
    <div class="stat-card-sys"><p>Ingresos Habitaciones</p><h3>S/. ${totalHabTotal.toFixed(2)}</h3><small>Incluye consumos</small></div>
    <div class="stat-card-sys"><p>Ingresos Tienda Pública</p><h3>S/. ${totalVentasPub.toFixed(2)}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>TOTAL GENERAL</p><h3>S/. ${(totalHabTotal+totalVentasPub).toFixed(2)}</h3></div>
    ${mHTML}`;
  // Habitaciones
  const groupHab={};
  checkins?.forEach(c=>{const k=c.habitaciones?.numero||'?';if(!groupHab[k])groupHab[k]={numero:k,categoria:c.habitaciones?.categoria,noches:0,total:0};if(c.check_out_real)groupHab[k].noches+=Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24));groupHab[k].total+=c.total_cobrado||0;});
  document.getElementById('reporte-habitaciones').innerHTML=Object.values(groupHab).length
    ?Object.values(groupHab).map(h=>`<tr><td>Hab. ${String(h.numero).padStart(3,'0')} (${CATEGORIA_LABELS[h.categoria]||h.categoria})</td><td>${h.noches}</td><td>S/. ${h.total.toFixed(2)}</td></tr>`).join('')
    :'<tr><td colspan="3" class="empty-row">Sin datos</td></tr>';
  // Tienda pública
  const groupPub={};
  ventasPub?.forEach(v=>{try{const ls=JSON.parse(v.lineas_json||'[]');ls.forEach(l=>{if(!groupPub[l.nombre])groupPub[l.nombre]={nombre:l.nombre,cantidad:0,total:0};groupPub[l.nombre].cantidad+=l.cantidad;groupPub[l.nombre].total+=l.subtotal||0;});}catch(e){if(!groupPub['Varios'])groupPub['Varios']={nombre:'Varios',cantidad:0,total:0};groupPub['Varios'].cantidad++;groupPub['Varios'].total+=v.total||0;}});
  document.getElementById('reporte-ventas').innerHTML=Object.values(groupPub).length
    ?Object.values(groupPub).sort((a,b)=>b.total-a.total).map(p=>`<tr><td>${p.nombre}</td><td>${p.cantidad}</td><td>S/. ${p.total.toFixed(2)}</td></tr>`).join('')
    :'<tr><td colspan="3" class="empty-row">Sin ventas en tienda pública</td></tr>';
  // Detalle checkins
  document.getElementById('reporte-checkins').innerHTML=checkins?.length
    ?checkins.map(c=>{
        const noches=c.check_out_real?Math.ceil((new Date(c.check_out_real)-new Date(c.check_in_fecha))/(1000*60*60*24)):'—';
        const costoHab=noches!=='—'?noches*(c.precio_noche||0):0;
        const consumos=Math.max(0,(c.total_cobrado||0)-costoHab);
        return `<tr>
          <td class="sm">${c.serie_comprobante||'—'}</td>
          <td>${String(c.habitaciones?.numero||'?').padStart(3,'0')}</td>
          <td>${c.clientes?.nombre||c.nombre_huesped}</td>
          <td>${formatDate(c.check_in_fecha)}</td>
          <td>${c.check_out_real?formatDate(c.check_out_real):'<span class="badge badge-verde">Activo</span>'}</td>
          <td>${noches}</td>
          <td>S/. ${costoHab.toFixed(2)}</td>
          <td>S/. ${consumos.toFixed(2)}</td>
          <td>${c.metodo_pago||'—'}</td>
          <td>S/. ${c.total_cobrado?.toFixed(2)||'—'}</td>
        </tr>`;}).join('')
    :'<tr><td colspan="10" class="empty-row">Sin datos</td></tr>';
}

// ══════════════════════════════════════════════════════════
//  COMPROBANTES
// ══════════════════════════════════════════════════════════
async function loadComprobantes(){
  const hoy=new Date().toISOString().split('T')[0];
  const fd=document.getElementById('filter-comp-desde');
  const fh=document.getElementById('filter-comp-hasta');
  if(fd){fd.removeAttribute('max');fd.removeAttribute('min');if(!fd.value)fd.value=hoy;}
  if(fh){fh.removeAttribute('max');fh.removeAttribute('min');if(!fh.value)fh.value=hoy;}
  if(!document.getElementById('btn-filtrar-comp')._bound){
    document.getElementById('btn-filtrar-comp')._bound=true;
    document.getElementById('btn-filtrar-comp').addEventListener('click',filtrarComprobantes);
    document.getElementById('search-comprobante')?.addEventListener('input',filtrarComprobantes);
    document.getElementById('filter-comp-tipo')?.addEventListener('change',filtrarComprobantes);
  }
  await filtrarComprobantes();
}
async function filtrarComprobantes(){
  const desde=(document.getElementById('filter-comp-desde')?.value||new Date().toISOString().split('T')[0])+'T00:00:00';
  const hasta=(document.getElementById('filter-comp-hasta')?.value||new Date().toISOString().split('T')[0])+'T23:59:59';
  const tipo=document.getElementById('filter-comp-tipo')?.value||'';
  const q=document.getElementById('search-comprobante')?.value.trim()||'';
  let query=sb.from('comprobantes').select('*, usuarios(nombre)').gte('created_at',desde).lte('created_at',hasta).order('created_at',{ascending:false});
  if(tipo) query=query.eq('tipo_serie',tipo);
  if(q)    query=query.ilike('serie',`%${q}%`);
  const { data:comps } = await query;
  const totalMonto=comps?.reduce((s,c)=>s+(c.total||0),0)||0;
  document.getElementById('comp-stats').innerHTML=`
    <div class="stat-card-sys"><p>Comprobantes emitidos</p><h3>${comps?.length||0}</h3></div>
    <div class="stat-card-sys"><p>Hab. / Check-outs</p><h3>${comps?.filter(c=>c.tipo_serie==='HAB').length||0}</h3></div>
    <div class="stat-card-sys"><p>Tienda pública</p><h3>${comps?.filter(c=>c.tipo_serie==='PUB').length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Total emitido</p><h3>S/. ${totalMonto.toFixed(2)}</h3></div>`;
  document.getElementById('comprobantes-table').innerHTML=comps?.length
    ?comps.map(c=>`<tr>
        <td><span class="badge badge-gold" style="font-size:11px">${c.serie}</span></td>
        <td><span class="badge ${c.tipo_serie==='HAB'?'badge-celeste':c.tipo_serie==='CAJA'?'badge-amarillo':'badge-verde'}">${{HAB:'Habitación',PUB:'Tienda',CAJA:'Caja'}[c.tipo_serie]||c.tipo_serie}</span></td>
        <td>${formatDate(c.created_at)} ${formatTime(c.created_at)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.cliente||'—'}<br><span style="font-size:10px;color:var(--text-light)">${c.descripcion||''}</span></td>
        <td>${c.metodo_pago||'—'}</td>
        <td><strong>S/. ${c.total?.toFixed(2)}</strong></td>
        <td style="white-space:nowrap">
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="reimprimirComp(${c.id})">🖨 Reimprimir</button>
            ${currentUserProfile?.rol==='admin'?`<button class="sys-btn sys-btn-outline sys-btn-sm" style="margin-left:4px" onclick="editarMetodoPago(${c.id})">✏️ Pago</button>`:''}
          </td>
      </tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">No hay comprobantes en este rango</td></tr>';
}
async function reimprimirComp(id){
  const { data:comp } = await sb.from('comprobantes').select('*').eq('id',id).single();
  if(!comp){showToast('Comprobante no encontrado','err');return;}
  reimprimirComprobante(comp);
}

// ══════════════════════════════════════════════════════════
//  CLIENTES
// ══════════════════════════════════════════════════════════
async function loadClientes(){
  const q=document.getElementById('search-cliente')?.value.toLowerCase()||'';
  let query=sb.from('clientes').select('*').order('nombre');
  if(q) query=query.or(`nombre.ilike.%${q}%,dni.ilike.%${q}%`);
  const { data:clientes } = await query;
  document.getElementById('clientes-table').innerHTML=clientes?.length
    ?clientes.map(c=>`<tr><td><strong>${c.nombre}</strong></td><td>${c.dni||'—'}</td><td>${c.telefono||'—'}</td><td>${c.email||'—'}</td><td>${c.ultima_estancia?formatDate(c.ultima_estancia):'—'}</td><td>—</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editCliente(${c.id})">Editar</button></td></tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">Sin clientes</td></tr>';
  const inp=document.getElementById('search-cliente');
  if(inp&&!inp._bound){inp._bound=true;inp.addEventListener('input',loadClientes);}
  const btnAdd=document.getElementById('btn-add-cliente');
  if(btnAdd) btnAdd.onclick=()=>{document.getElementById('cli-id').value='';document.getElementById('modal-cli-title').textContent='Nuevo cliente';['cli-nombre','cli-dni','cli-tel','cli-email','cli-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});openModal('modal-cliente');};
}
async function editCliente(id){
  const { data:c } = await sb.from('clientes').select('*').eq('id',id).single();
  document.getElementById('cli-id').value=id;document.getElementById('modal-cli-title').textContent='Editar cliente';
  document.getElementById('cli-nombre').value=c.nombre||'';document.getElementById('cli-dni').value=c.dni||'';document.getElementById('cli-tel').value=c.telefono||'';document.getElementById('cli-email').value=c.email||'';document.getElementById('cli-obs').value=c.observaciones||'';
  openModal('modal-cliente');
}
document.getElementById('btn-guardar-cliente')?.addEventListener('click',async()=>{
  const id=document.getElementById('cli-id').value;
  const data={nombre:document.getElementById('cli-nombre').value.trim(),dni:document.getElementById('cli-dni').value.trim(),telefono:document.getElementById('cli-tel').value.trim(),email:document.getElementById('cli-email').value.trim(),observaciones:document.getElementById('cli-obs').value.trim()};
  if(!data.nombre){showToast('Nombre obligatorio','err');return;}
  if(id) await sb.from('clientes').update(data).eq('id',id); else await sb.from('clientes').insert(data);
  showToast('Cliente guardado ✓','ok');closeModal('modal-cliente');loadClientes();
});

// ══════════════════════════════════════════════════════════
//  USUARIOS
// ══════════════════════════════════════════════════════════
async function loadUsuarios(){
  const { data:users } = await sb.from('usuarios').select('*').order('nombre');
  document.getElementById('users-table').innerHTML=users?.length
    ?users.map(u=>`<tr><td><strong>${u.nombre}</strong></td><td>${u.email||'—'}</td><td><span class="badge badge-gold">${rolLabel(u.rol)}</span></td><td><span class="badge ${u.activo?'badge-verde':'badge-rojo'}">${u.activo?'Activo':'Inactivo'}</span></td><td>${u.ultimo_acceso?formatDate(u.ultimo_acceso):'Nunca'}</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editUsuario(${u.id})">Editar rol</button><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleUsuario(${u.id},${!u.activo})">${u.activo?'Desact.':'Activar'}</button></td></tr>`).join('')
    :'<tr><td colspan="6" class="empty-row">Sin usuarios</td></tr>';
  const btnAdd=document.getElementById('btn-add-user');
  if(btnAdd) btnAdd.onclick=()=>{document.getElementById('usr-id').value='';['usr-nombre','usr-email','usr-password'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('usr-rol').value='recepcionista';document.getElementById('modal-usuario-title').textContent='Nuevo usuario';document.getElementById('usr-password-group').style.display='block';openModal('modal-usuario');};
}
async function editUsuario(id){
  const { data:u } = await sb.from('usuarios').select('*').eq('id',id).single();
  document.getElementById('usr-id').value=id;document.getElementById('modal-usuario-title').textContent='Editar usuario';document.getElementById('usr-nombre').value=u.nombre||'';document.getElementById('usr-email').value=u.email||'';document.getElementById('usr-rol').value=u.rol||'recepcionista';document.getElementById('usr-password-group').style.display='none';
  openModal('modal-usuario');
}
async function toggleUsuario(id,estado){await sb.from('usuarios').update({activo:estado}).eq('id',id);showToast('Actualizado','ok');loadUsuarios();}
function setupModalUsuario(){
  const btn=document.getElementById('btn-guardar-usuario');if(!btn)return;
  btn.addEventListener('click',async()=>{
    const id=document.getElementById('usr-id').value;
    const nombre=document.getElementById('usr-nombre').value.trim();
    const email=document.getElementById('usr-email').value.trim();
    const password=document.getElementById('usr-password')?.value;
    const rol=document.getElementById('usr-rol').value;
    if(!nombre||!email){showToast('Nombre y email obligatorios','err');return;}
    if(id){await sb.from('usuarios').update({nombre,rol}).eq('id',id);showToast('Usuario actualizado ✓','ok');}
    else{
      if(!password||password.length<6){showToast('Contraseña mínimo 6 caracteres','err');return;}
      btn.disabled=true;btn.textContent='Creando...';
      let authId=null;
      try{const resp=await fetch(`${SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${(await sb.auth.getSession()).data.session?.access_token}`},body:JSON.stringify({email,password,user_metadata:{nombre,rol},email_confirm:true})});const j=await resp.json();authId=j.id;}catch(e){}
      if(authId){await sb.from('usuarios').upsert({auth_id:authId,nombre,email,rol,activo:true},{onConflict:'email'});showToast('✅ Usuario creado','ok');}
      else{await sb.from('usuarios').upsert({nombre,email,rol,activo:true},{onConflict:'email'});showToast('⚠️ Perfil creado. Crea también el usuario en Supabase → Authentication → Add user.','ok');}
      btn.disabled=false;btn.textContent='Guardar usuario';
    }
    closeModal('modal-usuario');loadUsuarios();
  });
}

// ══════════════════════════════════════════════════════════
//  MODALES & UTILS
// ══════════════════════════════════════════════════════════
function setupModals(){
  document.querySelectorAll('.modal-close,[data-modal]').forEach(btn=>{
    btn.addEventListener('click',()=>{const modalId=btn.dataset.modal||btn.closest('.sys-modal')?.id;if(modalId)closeModal(modalId);});
  });
  document.querySelectorAll('.sys-modal').forEach(modal=>{modal.addEventListener('click',e=>{if(e.target===modal)closeModal(modal.id);});});
}
function openModal(id){const m=document.getElementById(id);if(m)m.style.display='flex';}
function closeModal(id){const m=document.getElementById(id);if(m)m.style.display='none';}
function showToast(msg,type='ok'){
  const t=document.getElementById('sys-toast');if(!t)return;
  t.textContent=msg;t.className=`sys-toast toast-${type}`;t.style.display='block';
  clearTimeout(t._timer);t._timer=setTimeout(()=>{t.style.display='none';},5000);
}
function formatDate(str){if(!str)return'—';return new Date(str).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});}
function formatTime(str){if(!str)return'—';return new Date(str).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}
function escStr(str){return(str||'').replace(/'/g,"\\'");}

// ══════════════════════════════════════════════════════════
//  RESERVAS WEB
// ══════════════════════════════════════════════════════════
async function loadReservasWeb(){
  const filterEstado=document.getElementById('filter-reserva-estado')?.value||'';
  const filterFecha=document.getElementById('filter-reserva-fecha')?.value||'';
  let q=sb.from('reservas_web').select('*').order('created_at',{ascending:false});
  if(filterEstado) q=q.eq('estado',filterEstado);
  if(filterFecha) q=q.eq('fecha_reserva',filterFecha);
  const { data:res } = await q;
  const pend=res?.filter(r=>r.estado==='pendiente').length||0;
  const conf=res?.filter(r=>r.estado==='confirmada').length||0;
  document.getElementById('reservas-stats').innerHTML=`
    <div class="stat-card-sys"><p>Total reservas</p><h3>${res?.length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:var(--warning)"><p>Pendientes</p><h3>${pend}</h3></div>
    <div class="stat-card-sys" style="border-left-color:var(--success)"><p>Confirmadas</p><h3>${conf}</h3></div>`;
  document.getElementById('reservas-table').innerHTML=res?.length
    ?res.map(r=>`<tr>
        <td>${formatDate(r.fecha_reserva)}</td>
        <td><strong>${r.hora_llegada||'—'}</strong></td>
        <td><strong>${r.nombre_cliente||'—'}</strong></td>
        <td>${r.dni_cliente||'—'}</td>
        <td>${r.telefono||'—'}</td>
        <td>${r.habitacion_tipo||'—'}</td>
        <td>${r.num_huespedes||1}</td>
        <td><span class="badge badge-${r.estado==='pendiente'?'amarillo':r.estado==='confirmada'?'verde':'rojo'}">${r.estado}</span></td>
        <td style="font-size:11px">${formatDate(r.created_at)} ${formatTime(r.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cambiarEstadoReserva(${r.id},'confirmada')">✅</button>
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cambiarEstadoReserva(${r.id},'cancelada')">❌</button>
          <button class="sys-btn sys-btn-gold sys-btn-sm" onclick="hacerCheckinDesdeReserva(${r.id})">🛏 Check-in</button>
        </td>
      </tr>`).join('')
    :'<tr><td colspan="10" class="empty-row">No hay reservas</td></tr>';
  ['filter-reserva-estado','filter-reserva-fecha'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.removeAttribute('max');el.removeAttribute('min');if(!el._bound){el._bound=true;el.addEventListener('change',loadReservasWeb);}}
  });
}
async function cambiarEstadoReserva(id,estado){
  await sb.from('reservas_web').update({estado}).eq('id',id);
  showToast(`Reserva ${estado}`,'ok'); loadReservasWeb();
}
async function hacerCheckinDesdeReserva(id){
  const { data:r } = await sb.from('reservas_web').select('*').eq('id',id).single();
  if(!r) return;
  const cat=r.habitacion_tipo?.toLowerCase().split(' ')[0]||'';
  const { data:habs } = await sb.from('habitaciones').select('*').eq('estado','disponible').ilike('categoria','%'+cat+'%').limit(1);
  if(habs?.length){
    openCheckinModal(habs[0]);
    setTimeout(()=>{
      document.getElementById('ci-nombre').value=r.nombre_cliente||'';
      document.getElementById('ci-dni').value=r.dni_cliente||'';
      document.getElementById('ci-tel').value=r.telefono||'';
      document.getElementById('ci-email').value=r.email||'';
      document.getElementById('ci-huespedes').value=r.num_huespedes||1;
      document.getElementById('ci-entrada').value=r.fecha_reserva||fechaPeruHoy();
    },100);
    await sb.from('reservas_web').update({estado:'confirmada'}).eq('id',id);
  } else {
    showToast('No hay habitaciones disponibles de esa categoría','err');
  }
}

// ══════════════════════════════════════════════════════════
//  COMENTARIOS WEB
// ══════════════════════════════════════════════════════════
async function loadComentarios(){
  const filtroLeido=document.getElementById('filter-com-leido')?.value||'';
  let q=sb.from('comentarios_web').select('*').order('created_at',{ascending:false});
  if(filtroLeido==='true') q=q.eq('leido',true);
  else if(filtroLeido==='false') q=q.eq('leido',false);
  const { data:coms } = await q;
  const noLeidos=coms?.filter(c=>!c.leido).length||0;
  const badge=document.getElementById('comentarios-count');
  if(badge) badge.textContent=`${noLeidos} sin leer`;
  document.getElementById('comentarios-table').innerHTML=coms?.length
    ?coms.map(c=>`<tr>
        <td style="font-size:11px">${formatDate(c.created_at)}</td>
        <td><strong>${c.nombre||'—'}</strong></td>
        <td>${c.email||'—'}</td>
        <td>${c.asunto||'Sin asunto'}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${c.mensaje||'—'}</td>
        <td><span class="badge ${c.leido?'badge-verde':'badge-amarillo'}">${c.leido?'Leído':'Nuevo'}</span></td>
        <td style="white-space:nowrap">
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="verComentario(${c.id})">Ver</button>
          ${!c.leido?`<button class="sys-btn sys-btn-outline sys-btn-sm" onclick="marcarLeido(${c.id})">✓</button>`:''}
        </td>
      </tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">No hay mensajes</td></tr>';
  const sel=document.getElementById('filter-com-leido');
  if(sel&&!sel._bound){sel._bound=true;sel.addEventListener('change',loadComentarios);}
}
async function verComentario(id){
  const { data:c } = await sb.from('comentarios_web').select('*').eq('id',id).single();
  if(!c) return;
  document.getElementById('modal-com-title').textContent=c.asunto||'Mensaje';
  document.getElementById('modal-com-body').innerHTML=`
    <div style="margin-bottom:14px">
      <div class="modal-info-row"><span>De</span><span><strong>${c.nombre}</strong></span></div>
      <div class="modal-info-row"><span>Email</span><span>${c.email||'—'}</span></div>
      <div class="modal-info-row"><span>Fecha</span><span>${formatDate(c.created_at)} ${formatTime(c.created_at)}</span></div>
    </div>
    <div style="background:var(--bg);padding:14px;border-radius:var(--radius-sm);line-height:1.6;font-size:13px">${c.mensaje||'—'}</div>
    <div class="form-actions">
      <button class="sys-btn sys-btn-outline" data-modal="modal-comentario">Cerrar</button>
      ${!c.leido?`<button class="sys-btn sys-btn-gold" onclick="marcarLeido(${c.id});closeModal('modal-comentario')">Marcar leído</button>`:''}
    </div>`;
  openModal('modal-comentario');
  if(!c.leido) await sb.from('comentarios_web').update({leido:true}).eq('id',id).then(()=>loadComentarios());
}
async function marcarLeido(id){
  await sb.from('comentarios_web').update({leido:true}).eq('id',id);
  showToast('Marcado como leído','ok'); loadComentarios();
}

// ══════════════════════════════════════════════════════════
//  NOTIFICACIONES REALTIME
// ══════════════════════════════════════════════════════════
let _notifChannel=null;

// Sonido de notificación (beep sintético con Web Audio API)
function reproducirSonidoNotif() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playBeep = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    playBeep(880, 0,    0.15);
    playBeep(1100, 0.18, 0.15);
    playBeep(1320, 0.36, 0.2);
  } catch(e) {}
}

let _lastNotifCount = 0;

async function initNotificaciones(){
  await cargarNotificaciones();
  if(_notifChannel) { try{ sb.removeChannel(_notifChannel); }catch(e){} }
  _notifChannel = sb.channel('notif-realtime-' + Date.now(), {
    config: { broadcast: { self: true } }
  })
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'notificaciones'
  }, payload => {
    reproducirSonidoNotif();
    mostrarNotifToast(payload.new);
    cargarNotificaciones();
  })
  .subscribe((status) => {
    console.log('Notif channel status:', status);
  });
}
async function cargarNotificaciones(){
  const { data:notifs } = await sb.from('notificaciones').select('*').eq('leida',false).order('created_at',{ascending:false}).limit(20);
  const count=notifs?.length||0;
  const badge=document.getElementById('notif-badge');
  if(badge){badge.textContent=count;badge.style.display=count>0?'flex':'none';}
  // Play sound if new notifications appeared (polling fallback)
  if(count > _lastNotifCount && _lastNotifCount >= 0) {
    if(_lastNotifCount >= 0 && count > 0) { /* sound already played by realtime */ }
  }
  _lastNotifCount = count;
  const list=document.getElementById('notif-list');
  if(!list) return;
  list.innerHTML=notifs?.length
    ?notifs.map(n=>`<div class="notif-item unread" onclick="abrirNotif(${n.id},'${n.tipo}')">
        <div class="notif-item-title">${n.tipo==='reserva_web'?'🏨':'💬'} ${n.titulo||'Notificación'}</div>
        <div class="notif-item-msg">${n.mensaje||''}</div>
        <div class="notif-item-time">${formatTime(n.created_at)}</div>
      </div>`).join('')
    :'<div class="notif-empty">Sin notificaciones nuevas</div>';
}
function mostrarNotifToast(n){
  showToast(`🔔 ${n.titulo}: ${n.mensaje}`,'ok');
  // Flash notification bell
  const bell = document.getElementById('notif-btn');
  if(bell) {
    bell.style.animation = 'bellRing 0.6s ease 3';
    setTimeout(() => { bell.style.animation = ''; }, 2000);
  }
}
async function abrirNotif(id,tipo){
  await sb.from('notificaciones').update({leida:true}).eq('id',id);
  closeNotifPanel();
  if(tipo==='reserva_web') loadSection('reservas-web');
  else loadSection('comentarios');
  cargarNotificaciones();
}
function toggleNotifPanel(){
  const p=document.getElementById('notif-panel');
  if(p) p.style.display=p.style.display==='none'||!p.style.display?'block':'none';
}
function closeNotifPanel(){const p=document.getElementById('notif-panel');if(p)p.style.display='none';}
async function marcarTodasLeidas(){
  await sb.from('notificaciones').update({leida:true}).eq('leida',false);
  cargarNotificaciones(); closeNotifPanel();
}
document.addEventListener('click',e=>{
  const panel=document.getElementById('notif-panel');
  const btn=document.getElementById('notif-btn');
  if(panel&&btn&&!panel.contains(e.target)&&!btn.contains(e.target)) panel.style.display='none';
});

// ══════════════════════════════════════════════════════════
//  EDITAR MÉTODO DE PAGO COMPROBANTE (solo admin)
// ══════════════════════════════════════════════════════════
async function editarMetodoPago(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo el administrador puede editar comprobantes','err');return;}
  const { data:comp } = await sb.from('comprobantes').select('serie,metodo_pago').eq('id',id).single();
  if(!comp) return;
  document.getElementById('edit-comp-id').value=id;
  document.getElementById('edit-comp-serie').value=comp.serie||'';
  const modal=document.getElementById('modal-editar-metodo');
  modal.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.metodo===comp.metodo_pago);
    btn.onclick=()=>{modal.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');};
  });
  openModal('modal-editar-metodo');
}
document.getElementById('btn-guardar-metodo')?.addEventListener('click',async()=>{
  const id=document.getElementById('edit-comp-id').value;
  const modal=document.getElementById('modal-editar-metodo');
  const metodo=modal.querySelector('.metodo-btn.active')?.dataset.metodo;
  if(!metodo||!id) return;
  // Also update datos_json so reprint shows updated method
  const { data:comp } = await sb.from('comprobantes').select('datos_json').eq('id',id).single();
  let updateData = { metodo_pago: metodo };
  if(comp?.datos_json) {
    try {
      const datos = typeof comp.datos_json==='string' ? JSON.parse(comp.datos_json) : comp.datos_json;
      datos.metodoPago = metodo;
      updateData.datos_json = JSON.stringify(datos);
    } catch(e){}
  }
  await sb.from('comprobantes').update(updateData).eq('id',id);
  showToast('Método de pago actualizado ✓','ok'); closeModal('modal-editar-metodo'); loadComprobantes();
});

// ══════════════════════════════════════════════════════════
//  HABITACIONES: AGREGAR / EDITAR / ELIMINAR (solo admin)
// ══════════════════════════════════════════════════════════
function abrirModalNuevaHab(){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  document.getElementById('hab-edit-id').value='';
  document.getElementById('modal-hab-edit-title').textContent='Nueva Habitación';
  ['hab-edit-numero','hab-edit-precio','hab-edit-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('hab-edit-piso').value='1';
  document.getElementById('hab-edit-categoria').value='economico';
  openModal('modal-habitacion-edit');
}
async function editarHabitacion(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  const { data:h } = await sb.from('habitaciones').select('*').eq('id',id).single();
  document.getElementById('hab-edit-id').value=id;
  document.getElementById('modal-hab-edit-title').textContent='Editar Habitación';
  document.getElementById('hab-edit-numero').value=h.numero||'';
  document.getElementById('hab-edit-piso').value=h.piso||1;
  document.getElementById('hab-edit-categoria').value=h.categoria||'economico';
  document.getElementById('hab-edit-precio').value=h.precio_noche||'';
  document.getElementById('hab-edit-desc').value=h.descripcion||'';
  openModal('modal-habitacion-edit');
}
document.getElementById('btn-guardar-habitacion')?.addEventListener('click',async()=>{
  const id=document.getElementById('hab-edit-id').value;
  const data={
    numero:parseInt(document.getElementById('hab-edit-numero').value)||0,
    piso:parseInt(document.getElementById('hab-edit-piso').value)||1,
    categoria:document.getElementById('hab-edit-categoria').value,
    precio_noche:parseFloat(document.getElementById('hab-edit-precio').value)||0,
    descripcion:document.getElementById('hab-edit-desc').value,
  };
  if(!data.numero){showToast('El número es obligatorio','err');return;}
  if(id) await sb.from('habitaciones').update(data).eq('id',id);
  else {data.estado='disponible'; await sb.from('habitaciones').insert(data);}
  showToast('Habitación guardada ✓','ok'); closeModal('modal-habitacion-edit'); loadHabitaciones();
});
async function eliminarHabitacion(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  if(!confirm('¿Eliminar esta habitación? Acción irreversible.')) return;
  await sb.from('habitaciones').delete().eq('id',id);
  showToast('Habitación eliminada','ok'); loadHabitaciones();
}
