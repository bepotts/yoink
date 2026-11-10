// Describes the Microsoft Graph response fields used by OneDrive folder selection and uploads.

export interface GraphItem {
  // Item ID unique within the user's drive.
  id?: string;
  // Display name for the item.
  name?: string;
  // Present only for actual folders.
  folder?: object;
  // Present for items that have been deleted.
  deleted?: object;
}
