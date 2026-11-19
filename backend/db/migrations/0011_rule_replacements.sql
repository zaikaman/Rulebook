create table if not exists rule_replacements (
  agent text not null,
  old_rule_id numeric(78, 0) not null,
  new_rule_id numeric(78, 0) not null,
  primary key (agent, old_rule_id),
  unique (agent, new_rule_id),
  check (old_rule_id >= 0 and new_rule_id > old_rule_id)
);

alter table rule_replacements enable row level security;
