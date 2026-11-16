-- `RuleEvaluated` carries the origin log the proof page needs. These columns let a cached proof
-- still render three rows when both RPCs are unreachable (T138).

alter table rule_events add column if not exists origin_chain_id int;
alter table rule_events add column if not exists origin_tx text;
alter table rule_events add column if not exists origin_log_index int;
alter table rule_events add column if not exists fired boolean;

create index if not exists rule_events_reactive_tx_idx on rule_events (tx_hash);
create index if not exists rule_events_origin_tx_idx on rule_events (origin_tx);
