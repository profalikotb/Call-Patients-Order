-- 008: remember each PC's Windows name + internet address, so an Access button pressed on a PC
--      automatically makes THAT PC the list source (both desktops are named DRALIKOTB → the address tells them apart)
alter table push_sources add column if not exists host text;
alter table push_sources add column if not exists ip text;
