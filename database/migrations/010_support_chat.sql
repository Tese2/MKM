CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('CUSTOMER', 'ADMIN')),
  message_text TEXT CHECK (message_text IS NULL OR length(trim(message_text)) BETWEEN 1 AND 2000),
  attachment_data BYTEA,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  admin_read_at TIMESTAMPTZ,
  customer_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (message_text IS NOT NULL AND length(trim(message_text)) > 0)
    OR attachment_data IS NOT NULL
  ),
  CHECK (
    (attachment_data IS NULL AND attachment_name IS NULL AND attachment_mime IS NULL AND attachment_size IS NULL)
    OR
    (attachment_data IS NOT NULL AND attachment_name IS NOT NULL AND attachment_mime IS NOT NULL
      AND attachment_size IS NOT NULL AND attachment_size = octet_length(attachment_data))
  )
);

CREATE INDEX support_messages_customer_created_idx
  ON support_messages(customer_id, created_at DESC, id DESC);

CREATE INDEX support_messages_admin_unread_idx
  ON support_messages(customer_id)
  WHERE sender_role = 'CUSTOMER' AND admin_read_at IS NULL;
