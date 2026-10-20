-- Structural inverse of 20261019100001_reconsent.sql: drops the two re-consent functions.
-- `consentimientos` rows written by consentimiento_aceptar are KEPT: they are evidence of what users
-- accepted. The app of this slice (the /aceptar-politica gate) calls these functions after login and
-- refuses to report a session when the check fails, so it must be reverted together with this script.

drop function public.consentimiento_aceptar(text);
drop function public.consentimiento_pendiente();
