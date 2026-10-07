-- Avisa por NOTIFY de cada evento público (ARCHITECTURE §7). El payload es el slug
-- de la sala; el SSE y wait_for_turn lo usan para despertar sin sondear.
-- NOTIFY dentro de una transacción solo se entrega al hacer COMMIT.
CREATE OR REPLACE FUNCTION reagentlab_notify_event() RETURNS trigger AS $$
BEGIN
  IF NEW.public AND NEW.lab_id IS NOT NULL THEN
    PERFORM pg_notify('lab_events', (SELECT slug FROM labs WHERE id = NEW.lab_id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION reagentlab_notify_event();
