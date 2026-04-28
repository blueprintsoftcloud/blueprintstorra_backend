// src/config/staffPermissions.ts
// Canonical list of all granular permissions that can be assigned to a STAFF user.
// Admin assigns any subset of these when creating/editing a staff member.

export const STAFF_PERMISSIONS = [
  // Category
  "CATEGORY_VIEW",
  "CATEGORY_ADD",
  "CATEGORY_EDIT",
  "CATEGORY_DELETE",
  // Product
  "PRODUCT_VIEW",
  "PRODUCT_ADD",
  "PRODUCT_EDIT",
  "PRODUCT_DELETE",
  // Order
  "ORDER_VIEW",
  "ORDER_UPDATE",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

// Grouped for display in the UI
export const PERMISSION_GROUPS = [
  {
    label: "Category Management",
    permissions: [
      { key: "CATEGORY_VIEW" as StaffPermission, label: "View / List Categories" },
      { key: "CATEGORY_ADD" as StaffPermission, label: "Add Category" },
      { key: "CATEGORY_EDIT" as StaffPermission, label: "Edit Category" },
      { key: "CATEGORY_DELETE" as StaffPermission, label: "Delete Category" },
    ],
  },
  {
    label: "Product Management",
    permissions: [
      { key: "PRODUCT_VIEW" as StaffPermission, label: "View / List Products" },
      { key: "PRODUCT_ADD" as StaffPermission, label: "Add Product" },
      { key: "PRODUCT_EDIT" as StaffPermission, label: "Edit Product" },
      { key: "PRODUCT_DELETE" as StaffPermission, label: "Delete Product" },
    ],
  },
  {
    label: "Order Management",
    permissions: [
      { key: "ORDER_VIEW" as StaffPermission, label: "View Orders" },
      { key: "ORDER_UPDATE" as StaffPermission, label: "Update Order Status" },
    ],
  },
] as const;
