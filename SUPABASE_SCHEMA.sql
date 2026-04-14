-- ============================================================
--  SCHEMA SUPABASE — Sistema de Gestión Hoteles Rio
--  Ejecuta este SQL en el SQL Editor de tu proyecto Supabase
-- ============================================================

-- ── 1. TABLA: usuarios (perfiles de trabajadores) ──────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            BIGSERIAL PRIMARY KEY,
  auth_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'recepcionista'
                CHECK (rol IN ('admin','recepcionista','cajero','limpieza')),
  activo        BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. TABLA: habitaciones ──────────────────────────────────
CREATE TABLE IF NOT EXISTS habitaciones (
  id            BIGSERIAL PRIMARY KEY,
  numero        INTEGER NOT NULL UNIQUE,
  piso          INTEGER NOT NULL DEFAULT 1,
  categoria     TEXT NOT NULL DEFAULT 'individual'
                CHECK (categoria IN ('individual','doble','matrimonial','suite')),
  estado        TEXT NOT NULL DEFAULT 'disponible'
                CHECK (estado IN ('disponible','ocupado','limpieza','mantenimiento','reservado')),
  precio_noche  NUMERIC(10,2) DEFAULT 0,
  descripcion   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. TABLA: clientes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id              BIGSERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  dni             TEXT,
  telefono        TEXT,
  email           TEXT,
  observaciones   TEXT,
  ultima_estancia DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_dni ON clientes(dni);

-- ── 4. TABLA: check_ins ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS check_ins (
  id                  BIGSERIAL PRIMARY KEY,
  habitacion_id       BIGINT REFERENCES habitaciones(id),
  cliente_id          BIGINT REFERENCES clientes(id),
  nombre_huesped      TEXT NOT NULL,
  dni_huesped         TEXT,
  check_in_fecha      DATE NOT NULL,
  check_out_estimado  DATE,
  check_out_real      TIMESTAMPTZ,
  num_huespedes       INTEGER DEFAULT 1,
  precio_noche        NUMERIC(10,2) DEFAULT 0,
  total_cobrado       NUMERIC(10,2),
  observaciones       TEXT,
  usuario_id          BIGINT REFERENCES usuarios(id),
  caja_id             BIGINT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. TABLA: productos (almacén) ───────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id              BIGSERIAL PRIMARY KEY,
  codigo          TEXT,
  nombre          TEXT NOT NULL,
  categoria       TEXT DEFAULT 'otros'
                  CHECK (categoria IN ('bebidas','snacks','higiene','servicios','otros')),
  precio_compra   NUMERIC(10,2) DEFAULT 0,
  precio_venta    NUMERIC(10,2) DEFAULT 0,
  stock           INTEGER DEFAULT 0,
  stock_minimo    INTEGER DEFAULT 5,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. TABLA: consumos_habitacion ──────────────────────────
CREATE TABLE IF NOT EXISTS consumos_habitacion (
  id              BIGSERIAL PRIMARY KEY,
  check_in_id     BIGINT REFERENCES check_ins(id),
  producto_id     BIGINT REFERENCES productos(id),
  cantidad        INTEGER NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(10,2) NOT NULL,
  precio_total    NUMERIC(10,2) NOT NULL,
  cobrado         BOOLEAN DEFAULT false,
  usuario_id      BIGINT REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. TABLA: ventas_publicas ───────────────────────────────
CREATE TABLE IF NOT EXISTS ventas_publicas (
  id          BIGSERIAL PRIMARY KEY,
  total       NUMERIC(10,2) NOT NULL,
  detalle     TEXT,
  usuario_id  BIGINT REFERENCES usuarios(id),
  caja_id     BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. TABLA: cajas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cajas (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT REFERENCES usuarios(id),
  fecha       DATE NOT NULL,
  estado      TEXT DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  total       NUMERIC(10,2) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. TABLA: movimientos_caja ──────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_caja (
  id          BIGSERIAL PRIMARY KEY,
  caja_id     BIGINT REFERENCES cajas(id),
  concepto    TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  monto       NUMERIC(10,2) NOT NULL,
  usuario_id  BIGINT REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── FK: check_ins.caja_id → cajas.id (añadir después) ──────
ALTER TABLE check_ins ADD CONSTRAINT fk_checkin_caja FOREIGN KEY (caja_id) REFERENCES cajas(id);
ALTER TABLE ventas_publicas ADD CONSTRAINT fk_venta_caja FOREIGN KEY (caja_id) REFERENCES cajas(id);

-- ══════════════════════════════════════════════════════════════
--  FUNCIÓN: descontar_stock (llamada como RPC)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION descontar_stock(p_producto_id BIGINT, p_cantidad INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE productos
  SET stock = stock - p_cantidad
  WHERE id = p_producto_id AND stock >= p_cantidad;
END;
$$;

-- ══════════════════════════════════════════════════════════════
--  FUNCIÓN: actualizar total de caja al insertar movimiento
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_update_caja_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'ingreso' THEN
    UPDATE cajas SET total = total + NEW.monto WHERE id = NEW.caja_id;
  ELSE
    UPDATE cajas SET total = total - NEW.monto WHERE id = NEW.caja_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_caja_total
AFTER INSERT ON movimientos_caja
FOR EACH ROW EXECUTE FUNCTION fn_update_caja_total();

-- ── FUNCIÓN: actualizar ultima_estancia del cliente ─────────
CREATE OR REPLACE FUNCTION fn_update_ultima_estancia()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    UPDATE clientes SET ultima_estancia = NEW.check_in_fecha WHERE id = NEW.cliente_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ultima_estancia
AFTER INSERT ON check_ins
FOR EACH ROW EXECUTE FUNCTION fn_update_ultima_estancia();

-- ══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS) — Seguridad básica
-- ══════════════════════════════════════════════════════════════
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE habitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumos_habitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_publicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_caja ENABLE ROW LEVEL SECURITY;

-- Política: solo usuarios autenticados pueden ver/editar
CREATE POLICY "auth_users_only" ON usuarios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON habitaciones FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON clientes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON check_ins FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON productos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON consumos_habitacion FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON ventas_publicas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON cajas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users_only" ON movimientos_caja FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
--  DATOS INICIALES: Habitaciones (ajusta según tu hotel)
-- ══════════════════════════════════════════════════════════════
INSERT INTO habitaciones (numero, piso, categoria, precio_noche) VALUES
  (101, 1, 'individual',   80),
  (102, 1, 'individual',   80),
  (103, 1, 'doble',       120),
  (104, 1, 'doble',       120),
  (105, 1, 'matrimonial', 140),
  (201, 2, 'individual',   80),
  (202, 2, 'doble',       120),
  (203, 2, 'matrimonial', 140),
  (204, 2, 'suite',       220),
  (301, 3, 'suite',       250)
ON CONFLICT (numero) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
--  TRIGGER: Crear perfil en tabla usuarios al registrar auth user
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_create_user_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.usuarios (auth_id, nombre, email, rol)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email,'@',1)), NEW.email, COALESCE(NEW.raw_user_meta_data->>'rol','recepcionista'))
  ON CONFLICT (email) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION fn_create_user_profile();

