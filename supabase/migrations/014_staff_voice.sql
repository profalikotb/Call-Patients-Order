-- 014: voice notes from the doctor (iPhone / PC) to the assistant
alter table staff_messages add column if not exists audio_path text;
alter table staff_messages add column if not exists audio_type text;
