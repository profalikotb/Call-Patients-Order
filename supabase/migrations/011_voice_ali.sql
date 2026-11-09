-- 011: make «علي» (Microsoft Ali, Arabic-Bahrain, male) the call voice for every clinic.
--      Change it any time in Admin → Voice settings.
insert into clinic_settings (clinic_id) select id from clinics on conflict do nothing;
update clinic_settings set voice = coalesce(voice, '{}'::jsonb) || '{"azureVoice":"ar-BH-AliNeural"}'::jsonb, updated_at = now();
