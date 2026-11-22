# AnoCo student-message intake policy (DRAFT — NOT APPROVED)

**Status:** Draft — approval and operational details must be verified before real student use. The form and counselor inbox now have a prototype implementation, but submissions are disabled by default. When enabled, messages exist only in the server process's memory, are deleted after the configured cumulative counselor-online retention time or by a counselor, and are lost on service restart or sleep. The timer pauses when no counselor presence is active. This is not durable storage or a guarantee of review.

## Proposed student notice

> **Before you send:** If this feature is approved and enabled, submitting will send the topic, message, and any optional contact details you choose to add to AnoCo's school counselor inbox. A name or preferred name, email address, phone number, and grade or section are optional. Only counselors with an approved school account can access the inbox. Please avoid unnecessary identifying details. Messages are not a crisis service and a response is not guaranteed to be immediate. If you or someone else may be in immediate danger, tell a trusted adult now or contact local emergency services.

Before publication, the school must replace or confirm the notice, including the actual monitoring coverage, response expectations, retention period, and any legally required student/parent notice or consent.

## Proposed handling requirements

### Data and access

- Collect only the selected topic and message text. Do not request names, email addresses, school identifiers, health records, or other personal details.
- Require a secure backend and counselor authentication. Restrict reading and deletion to individually approved school counselor accounts; do not expose message content in public APIs, analytics, browser storage, or application logs.
- Use encrypted transport and school-approved hosting and access controls. Review security, backups, incident response, and vendor data handling before launch.
- The message API uses the existing allowlisted counselor Google sign-in for inbox reading and deletion. The prototype message store is in memory, not durable, and is lost on server restart or sleep. It must not be treated as an approved production message store without a separate technical and security review.
- Messages are separate from audio calls. They are not associated with a call and are not deleted when a call ends. Students receive no reply channel.

### Monitoring and safeguarding

- Advertise “monitored 24/7” only after the school verifies continuous staffed coverage, named shift ownership, backup coverage, handoff procedures, and a way to respond to missed or unattended messages.
- Define the expected response time and who is responsible for reviewing each submission. Do not promise that a message will be read or answered immediately.
- Train counselors on the school's safeguarding, mandatory-reporting, and urgent-risk escalation procedures. The form must not be presented as counseling, diagnosis, emergency monitoring, or crisis support.
- Provide clear urgent-help instructions next to the submission control. The school must approve the exact wording and procedure for messages that suggest immediate risk.
- This anonymous form has no reply channel. If the school wants counselors to respond, it must approve a safe reply method and separately review the extra data and risks that method would require.

### Retention and deletion

- Counselors can delete messages from the inbox. The prototype also removes messages after the configured `MESSAGE_RETENTION_HOURS` of cumulative time while at least one counselor presence is active (1–720 hours). The timer pauses when no counselor is online; it does not measure wall-clock time from submission.
- **School decision required before launch:** approve the maximum retention period, identify who checks and enforces deletion, and explain whether hosting-provider records can retain content after deletion. The in-memory prototype cannot enforce deletion from provider records or recover data after a restart.
- Confirm how student requests for deletion, access, or correction will be handled, where legally applicable.

## Approval checklist before enabling submission

- [ ] School leadership and the designated privacy/safeguarding owner approve this policy and the student notice.
- [ ] Applicable student privacy, consent, safeguarding, and record-retention requirements are reviewed for the school's jurisdiction and student age group.
- [ ] The school confirms actual 24/7 staffing, response expectations, handoffs, and urgent-risk escalation.
- [ ] A durable, secure, access-controlled inbox is implemented and reviewed; approved counselors can read and delete messages, and unauthorized users cannot. The current in-memory prototype does not satisfy the durability requirement.
- [ ] A maximum counselor-online retention/deletion rule, backup behavior, incident response, and provider handling are documented.
- [ ] A reply method is either explicitly out of scope or approved and safely implemented.
- [ ] The end-to-end workflow is tested with staff test data before real student use.

Until every required item is approved and verified, leave `MESSAGE_INTAKE_ENABLED` set to `false` and do not claim submissions are monitored or seen by counselors.
