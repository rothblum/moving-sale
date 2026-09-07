# Moving Sale site

A small static site listing furniture for sale, hosted free on GitHub Pages.

- **Public page** — `index.html`, anyone can browse it.
- **Editor** — `admin.html`, only people with write access to this repo can save changes.
- **The data** — everything on the public page comes from `items.json`. Photos live in `images/`.

## For Guy — how to edit the listing

1. Open the editor: **`https://rothblum.github.io/moving-sale/admin.html`** (bookmark it).
2. The first time, it asks for a GitHub access token. Create one here:
   <https://github.com/settings/personal-access-tokens/new>
   - **Repository access** → *Only select repositories* → this repo
   - **Permissions → Repository permissions → Contents** → *Read and write*
   - Generate, copy, paste it into the editor, tick *Stay signed in*.
3. Edit prices, change an item to **Sold**, reorder, add photos, add or delete items.
4. Press **Save changes**. The public page updates about a minute later.

The token is stored only in that browser and is sent only to github.com. Visitors to the
public page never see the editor and cannot change anything — GitHub rejects any write
that does not come with a token that has access to this repository.

Photos are automatically resized to 1600px and compressed before upload, so you can
upload straight from a phone.

## How the security works

GitHub Pages serves static files, so `admin.html` is technically visible to anyone who
finds the URL. That is fine: it is just a form. Saving goes through the GitHub API, which
only accepts a commit when the request carries a token with write access to this
repository — something only you and the repo owner have.

## Editing without the admin page

`items.json` is plain JSON and can be edited directly on github.com. Each item looks like:

```json
{
  "id": "unique-id",
  "title": "Grey 3-seat sofa",
  "price": 250,
  "status": "available",
  "category": "Living room",
  "condition": "Very good",
  "dimensions": "83\" W × 39\" D × 32\" H",
  "description": "Comfortable three-seater…",
  "photos": ["images/sofa-a1b2c.jpg"]
}
```

`status` is one of `available`, `pending` (shown as *On hold*) or `sold`.
Set `price` to `null` to display *Ask*.

## Running it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
