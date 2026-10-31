-- Demo sellers: real businesses from BTC Map shown in the catalog as examples. A seller with btcmap_id
-- is a demo profile; every other seller keeps the normal flow and has btcmap_id null.
--
-- The column is granted the same way as the other public columns of negocios (see
-- 20261012000003_privilegios.sql), so the catalog can label demo sellers. Nothing else about a
-- seller changes.

alter table public.negocios
  add column btcmap_id integer unique check (btcmap_id is null or btcmap_id > 0);

grant select (btcmap_id) on public.negocios to anon, authenticated;
