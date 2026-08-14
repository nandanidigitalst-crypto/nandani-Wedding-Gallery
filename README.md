# Nandani Wedding Gallery

Secure wedding photo/video gallery with separate **Admin Login** and **Customer Login**.

## Login system

### Admin
Open `/admin.html`.

Set these Railway/server variables:

- `ADMIN_USERNAME` — optional, default `admin`
- `ADMIN_PASSWORD` — required, strong password

For a password hash instead of plain environment value, use `ADMIN_PASSWORD_HASH` generated with Node's `crypto.scrypt`; do not put secrets in GitHub.

Admin can:
- Create customers/weddings
- Generate a Wedding ID
- Set a customer Access Code
- Set package price
- Mark payment paid/unpaid
- Upload/delete photos and videos
- Open a private wedding gallery

### Customer
Open `/customer.html`.

Customer logs in with:
- **Wedding ID** like `WED-A1B2C3`
- **Access Code** created by the admin

Customers can only see/download files belonging to their own wedding.

Sessions use an HttpOnly cookie. Passwords/access codes are stored as scrypt hashes. Media routes are also authenticated, so a direct media URL cannot be used to bypass the customer login.

## Uploads
- 8 MB chunked uploads
- Application single-file limit: 20 GB
- Photos and long videos
- Browser playback
- Download
- Admin-only upload/delete

## Railway
Deploy the repository and configure:

`STORAGE_ROOT=/app/storage`

Attach a Railway Volume at:

`/app/storage`

Also configure:

`ADMIN_USERNAME=admin`
`ADMIN_PASSWORD=<your strong password>`

Generate the Railway domain after deployment.

For very large libraries, object storage such as S3-compatible storage is recommended.

## Local run

Node.js 18+:

```bash
npm install
ADMIN_PASSWORD=ChangeThisStrongPassword npm start
```

Then open:

- `/` — public studio page
- `/admin.html` — admin login
- `/customer.html` — customer login
