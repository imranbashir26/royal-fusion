-- Phase 3B: public review reads and all writes go through the validated API.
begin;

drop policy if exists rf_reviews_public_read on public.reviews;
create policy rf_reviews_public_read on public.reviews for select to anon, authenticated
using (status = 'Approved');

revoke select, insert, update, delete on public.reviews from anon, authenticated;

commit;
