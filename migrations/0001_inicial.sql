-- alDia · esquema inicial (D1 / SQLite).
-- Los datos personales de cada familia solo se guardan cifrados (columna familias.blob).

CREATE TABLE familias (
  id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,                -- JSON cifrado en el móvil {v:2, iv, datos}
  version INTEGER NOT NULL DEFAULT 1,-- control de cambios concurrentes
  creada TEXT NOT NULL,
  actualizada TEXT NOT NULL
);

CREATE TABLE dispositivos (
  id TEXT PRIMARY KEY,
  familia_id TEXT NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,   -- SHA-256 del token; el token solo lo tiene el móvil
  nombre TEXT NOT NULL,
  creado TEXT NOT NULL,
  ultimo_uso TEXT,
  revocado TEXT,
  suscripcion TEXT                   -- suscripción push (fase 3)
);
CREATE INDEX dispositivos_familia ON dispositivos(familia_id);

CREATE TABLE invitaciones (
  hash TEXT PRIMARY KEY,             -- SHA-256 del código de invitación
  tipo TEXT NOT NULL CHECK (tipo IN ('familia', 'miembro')),
  familia_id TEXT REFERENCES familias(id) ON DELETE CASCADE,
  creada TEXT NOT NULL,
  caduca TEXT NOT NULL,
  usada TEXT
);

-- Agenda compartida: una fila por colegio y por clase (festivos, horario, actividades, circulares).
CREATE TABLE capas (
  ambito TEXT NOT NULL CHECK (ambito IN ('colegio', 'clase')),
  id TEXT NOT NULL,
  colegio_id TEXT,                   -- solo en las clases
  nombre TEXT NOT NULL,
  datos TEXT NOT NULL,               -- JSON
  version INTEGER NOT NULL DEFAULT 1,
  actualizada TEXT NOT NULL,
  PRIMARY KEY (ambito, id)
);

-- Qué clases sigue cada familia (lo único que el servidor sabe de sus peques).
CREATE TABLE familia_clases (
  familia_id TEXT NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  clase_id TEXT NOT NULL,
  PRIMARY KEY (familia_id, clase_id)
);

-- Familias que pueden publicar en un colegio o una clase (las circulares).
CREATE TABLE gestores (
  familia_id TEXT NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  ambito TEXT NOT NULL CHECK (ambito IN ('colegio', 'clase')),
  capa_id TEXT NOT NULL,
  PRIMARY KEY (familia_id, ambito, capa_id)
);
