-- 011: call voice for every clinic = ElevenLabs «Mamdoh – Deep Egyptian Arabic Male».
--      Needs ELEVENLABS_API_KEY in Vercel. Until then (or if ElevenLabs fails) the TV speaks with
--      Microsoft «Shakir» (Egyptian male) in Edge. Change any time in Admin → Voice settings.
insert into clinic_settings (clinic_id) select id from clinics on conflict do nothing;
update clinic_settings
   set voice = coalesce(voice, '{}'::jsonb)
             || '{"provider":"elevenlabs","elevenVoiceId":"68MRVrnQAt8vLbu0FCzw","azureVoice":"ar-EG-ShakirNeural"}'::jsonb,
       updated_at = now();
