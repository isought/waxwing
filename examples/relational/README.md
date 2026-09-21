# Fictional order storage

This public example demonstrates a relational model independently from any
private application. `postgres-catalog.json` is an authored catalog-shaped
fixture, not an observation of a running deployment. `model.json` adds an explicit
application-enforced JSON association and an illustrative architecture mapping.

The example covers:

- Customers and orders, with a required customer foreign key.
- Line items with an ordered `(customer_id, order_id)` foreign key that enforces
  ownership against `(customer_id, id)` on orders.
- A unique email index that applies only to active customers. It must not be
  treated as unconditional uniqueness.
- A computed index expression retained as SQL text.
- Audit JSON whose order reference is an application claim, not a database FK.

See [the format and acquisition documentation](../../docs/relational.md).
