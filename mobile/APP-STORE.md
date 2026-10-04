# Slice Party App Store release

## Status: October 4, 2026

Version **1.0.0 (2)** was submitted to Apple at 04:31 UTC and is **Waiting for Review**. Automatic release after approval is selected. Submission does not mean the app is already published.

- [App Store Connect record](https://appstoreconnect.apple.com/apps/6818936828/distribution/ios/version/inflight)
- App name: **Slice Party: Swing the Blade**
- Bundle identifier: `com.emirhansimsek.sliceparty`
- [Signed production build](https://expo.dev/accounts/emirhansimsek_lightning/projects/slice-party/builds/8109741c-5ffa-4ae9-ab1e-0d60b358d02b)
- Review submission: `f52bb8dc-59dd-4bbc-95e0-d9ac67664033`
- Price: **Free**. No in-app purchases or subscriptions.
- Availability: **173 regions**, with new territories enabled automatically. China mainland and Vietnam remain unavailable pending the additional game-publishing approvals required by Apple. No licence documents were supplied.
- English listing, subtitle, promotional text, keywords, categories, copyright, content rights, age-rating questionnaire, review contact and instructions are saved.
- Four native iPhone screenshots are uploaded and processed. See [capture details](store-assets/README.md).
- App Privacy is published: Gameplay Content for App Functionality, not linked to identity; Other Diagnostic Data for App Functionality, linked to identity because Firebase retains IP addresses and user-agent information. Neither is used for tracking.
- Dark Interface support for iPhone is saved as an accessibility draft; Apple permits publishing the device declaration after an app version is released. Other accessibility features are not claimed.

## Public pages

- [Game](https://emirhan777.github.io/SliceParty/)
- [Support](https://emirhan777.github.io/SliceParty/support.html)
- [Privacy policy and choices](https://emirhan777.github.io/SliceParty/privacy.html)

## Release evidence

The IPA's bundle identifier, version, build number, iPhone device family, iOS 16.4 minimum, and non-exempt-encryption flag were verified before upload. Apple's direct Build Upload API accepted the archive with no errors or warnings; the build processed as VALID and was attached to the version. App Store Connect then accepted the review submission.

The production build uses the existing Apple team's distribution certificate with a dedicated App Store provisioning profile for this bundle. `credentials.json`, private signing files and review contact details remain ignored locally; none are committed to the public repository.

`store-listing.json` and `store-review-notes.txt` preserve the public listing and reviewer instructions. Typecheck, lint, unit tests, the native simulator screenshot flow and the signed production build passed.

[Apple regional availability requirements](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
