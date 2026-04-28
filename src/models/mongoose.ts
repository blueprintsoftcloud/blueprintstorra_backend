import mongoose, { Document, Schema } from 'mongoose';

// ───────────────────────────── ENUMS ───────────────────────────────

export const RoleEnum = ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN', 'STAFF'] as const;
export type Role = typeof RoleEnum[number];

export const Role = { CUSTOMER: 'CUSTOMER', ADMIN: 'ADMIN', SUPER_ADMIN: 'SUPER_ADMIN', STAFF: 'STAFF' } as const;
export const FeatureEnum = [
  'USER_MANAGEMENT',
  'CATEGORY_MANAGEMENT',
  'PRODUCT_MANAGEMENT',
  'ORDER_MANAGEMENT',
  'COUPON_MANAGEMENT',
  'NOTIFICATION_MANAGEMENT',
  'REPORTS_ANALYTICS',
  'STAFF_MANAGEMENT',
  'STAFF_PERMISSION_MANAGEMENT',
  'WAREHOUSE_SETTINGS',
  'AUDIT_LOG',
  'CUSTOMER_ACTIVITY_TRACKER',
  'PAYMENT_LOGS',
  'PRODUCT_REVIEWS',
  'HOMEPAGE_MANAGEMENT',
  'ADMIN_ORDER',
] as const;
export type Feature = typeof FeatureEnum[number];
export const OrderStatusEnum = ['PROCESSING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatus = typeof OrderStatusEnum[number];

export const PaymentStatusEnum = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export const PaymentMethodEnum = ['ONLINE', 'POD', 'CASH'] as const;

export const NotificationTypeEnum = ['NEW_ORDER', 'ORDER_UPDATE', 'PAYMENT_FAILED', 'PAYMENT_SUCCESS', 'LOW_STOCK', 'GENERAL'] as const;
export type NotificationType = typeof NotificationTypeEnum[number];
export const AttributeTypeEnum = ['SELECT', 'MULTISELECT', 'TEXT', 'NUMBER', 'BOOLEAN'];

// ───────────────────────────── USER ───────────────────────────────

export interface IUser extends Document {
  username: string;
  email?: string;
  phone: string;
  password?: string;
  role: string;
  isVerified: boolean;
  refreshToken?: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true },
    email: { type: String, sparse: true },
    phone: { type: String, unique: true, required: true },
    password: String,
    role: { type: String, enum: RoleEnum, default: 'CUSTOMER' },
    isVerified: { type: Boolean, default: false },
    refreshToken: String,
    avatar: String,
  },
  { timestamps: true }
);
UserSchema.index({ role: 1 });

export const User = mongoose.model<IUser>('User', UserSchema);

// ───────────────────────────── ADDRESS ───────────────────────────────

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId;
  fullAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  landmark?: string;
  isDefault: boolean;
  latitude?: number;
  longitude?: number;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fullAddress: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, default: 'India' },
    landmark: String,
    isDefault: { type: Boolean, default: false },
    latitude: Number,
    longitude: Number,
  },
  { timestamps: true }
);
AddressSchema.index({ userId: 1 });

export const Address = mongoose.model<IAddress>('Address', AddressSchema);

// ───────────────────────────── CATEGORY ───────────────────────────────

export interface ICategory extends Document {
  code: string;
  name: string;
  description?: string;
  image?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    code: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    description: String,
    image: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Category = mongoose.model<ICategory>('Category', CategorySchema);

// ───────────────────────────── PRODUCT ───────────────────────────────

export interface IProduct extends Document {
  code: string;
  name: string;
  description?: string;
  purchasePrice?: number;
  price: number;
  stock: number;
  sizes: string[];
  discount: number;
  image?: string;
  images: string[];
  rating: number;
  numReviews: number;
  isActive: boolean;
  isFeatured: boolean;
  featuredOrder?: number;
  categoryId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    code: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    description: String,
    purchasePrice: Number,
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    sizes: { type: [String], default: [] },
    discount: { type: Number, default: 0 },
    image: String,
    images: { type: [String], default: [] },
    rating: { type: Number, default: 0 },
    numReviews: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    featuredOrder: Number,
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  },
  { timestamps: true }
);
ProductSchema.index({ categoryId: 1 });
ProductSchema.index({ name: 1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ isActive: 1 });
ProductSchema.index({ isFeatured: 1 });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);

// ───────────────────────────── CATEGORY ATTRIBUTE ───────────────────────────────

export interface ICategoryAttribute extends Document {
  categoryId: mongoose.Types.ObjectId;
  name: string;
  type: string;
  isFilterable: boolean;
  isRequired: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const CategoryAttributeSchema = new Schema<ICategoryAttribute>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true },
    type: { type: String, enum: AttributeTypeEnum, required: true },
    isFilterable: { type: Boolean, default: true },
    isRequired: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);
CategoryAttributeSchema.index({ categoryId: 1, name: 1 }, { unique: true });

export const CategoryAttribute = mongoose.model<ICategoryAttribute>('CategoryAttribute', CategoryAttributeSchema);

// ───────────────────────────── CATEGORY ATTRIBUTE VALUE ───────────────────────────────

export interface ICategoryAttributeValue extends Document {
  attributeId: mongoose.Types.ObjectId;
  value: string;
  sortOrder: number;
}

const CategoryAttributeValueSchema = new Schema<ICategoryAttributeValue>(
  {
    attributeId: { type: Schema.Types.ObjectId, ref: 'CategoryAttribute', required: true },
    value: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
  }
);
CategoryAttributeValueSchema.index({ attributeId: 1, value: 1 }, { unique: true });

export const CategoryAttributeValue = mongoose.model<ICategoryAttributeValue>(
  'CategoryAttributeValue',
  CategoryAttributeValueSchema
);

// ───────────────────────────── PRODUCT ATTRIBUTE VALUE ───────────────────────────────

export interface IProductAttributeValue extends Document {
  productId: mongoose.Types.ObjectId;
  attributeId: mongoose.Types.ObjectId;
  attributeValueId?: mongoose.Types.ObjectId;
  textValue?: string;
}

const ProductAttributeValueSchema = new Schema<IProductAttributeValue>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    attributeId: { type: Schema.Types.ObjectId, ref: 'CategoryAttribute', required: true },
    attributeValueId: { type: Schema.Types.ObjectId, ref: 'CategoryAttributeValue' },
    textValue: String,
  }
);
ProductAttributeValueSchema.index({ productId: 1 });
ProductAttributeValueSchema.index({ attributeId: 1 });

export const ProductAttributeValue = mongoose.model<IProductAttributeValue>(
  'ProductAttributeValue',
  ProductAttributeValueSchema
);

// ───────────────────────────── CART ───────────────────────────────

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICartItem extends Document {
  cartId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>(
  {
    cartId: { type: Schema.Types.ObjectId, ref: 'Cart', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const CartSchema = new Schema<ICart>(
  {
    userId: { type: Schema.Types.ObjectId, unique: true, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const Cart = mongoose.model<ICart>('Cart', CartSchema);
export const CartItem = mongoose.model<ICartItem>('CartItem', CartItemSchema);

// ───────────────────────────── ORDER ───────────────────────────────

export interface IOrderItem extends Document {
  orderId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
}

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  totalAmount: number;
  shippingCharge: number;
  discountAmount: number;
  taxAmount: number;
  finalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  shippingAddress: any;
  couponId?: mongoose.Types.ObjectId;
  placedByAdminId?: mongoose.Types.ObjectId;
  items?: IOrderItem[]; // populated
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
  }
);
OrderItemSchema.index({ orderId: 1 });

const OrderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    totalAmount: { type: Number, required: true },
    shippingCharge: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true },
    paymentMethod: { type: String, enum: PaymentMethodEnum, required: true },
    paymentStatus: { type: String, enum: PaymentStatusEnum, default: 'PENDING' },
    orderStatus: { type: String, enum: OrderStatusEnum, default: 'PROCESSING' },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    shippingAddress: { type: Schema.Types.Mixed, required: true },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    placedByAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
OrderSchema.index({ userId: 1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ createdAt: 1 });
OrderSchema.index({ placedByAdminId: 1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
export const OrderItem = mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);

// ───────────────────────────── WISHLIST ───────────────────────────────

export interface IWishlist extends Document {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const WishlistSchema = new Schema<IWishlist>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: true }
);
WishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const Wishlist = mongoose.model<IWishlist>('Wishlist', WishlistSchema);

// ───────────────────────────── REVIEW ───────────────────────────────

export interface IReview extends Document {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    rating: { type: Number, required: true },
    comment: String,
  },
  { timestamps: true }
);
ReviewSchema.index({ userId: 1, productId: 1 }, { unique: true });
ReviewSchema.index({ productId: 1 });

export const Review = mongoose.model<IReview>('Review', ReviewSchema);

// ───────────────────────────── NOTIFICATION ───────────────────────────────

export interface INotification extends Document {
  message: string;
  type: string;
  isRead: boolean;
  orderId?: mongoose.Types.ObjectId;
  triggeredById?: mongoose.Types.ObjectId;
  recipientId?: mongoose.Types.ObjectId;
  recipientRole: string;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    message: { type: String, required: true },
    type: { type: String, enum: NotificationTypeEnum, required: true },
    isRead: { type: Boolean, default: false },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    triggeredById: { type: Schema.Types.ObjectId, ref: 'User' },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User' },
    recipientRole: { type: String, default: 'admin' },
  },
  { timestamps: true }
);
NotificationSchema.index({ recipientId: 1 });
NotificationSchema.index({ recipientRole: 1, isRead: 1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);

// ───────────────────────────── OTP ───────────────────────────────

export interface IOtp extends Document {
  email: string;
  otp: string;
  purpose: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const OtpSchema = new Schema<IOtp>(
  {
    email: { type: String, required: true },
    otp: { type: String, required: true },
    purpose: { type: String, default: 'login' },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);
OtpSchema.index({ email: 1, purpose: 1 });

export const Otp = mongoose.model<IOtp>('Otp', OtpSchema);

// ───────────────────────────── TEMP UPDATE ───────────────────────────────

export interface ITempUpdate extends Document {
  userId: mongoose.Types.ObjectId;
  pendingData: any;
  otp: string;
  expiresAt: Date;
  createdAt: Date;
}

const TempUpdateSchema = new Schema<ITempUpdate>(
  {
    userId: { type: Schema.Types.ObjectId, unique: true, ref: 'User', required: true },
    pendingData: { type: Schema.Types.Mixed, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const TempUpdate = mongoose.model<ITempUpdate>('TempUpdate', TempUpdateSchema);

// ───────────────────────────── COUPON ───────────────────────────────

export interface ICoupon extends Document {
  code: string;
  description?: string;
  discountType: string;
  discountValue: number;
  minOrderAmount: number;
  maxUses?: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: { type: String, unique: true, required: true },
    description: String,
    discountType: { type: String, enum: ['PERCENTAGE', 'FLAT'], required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxUses: Number,
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: Date,
  },
  { timestamps: true }
);

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema);

// ───────────────────────────── STAFF PROFILE ───────────────────────────────

export interface IStaffProfile extends Document {
  userId: mongoose.Types.ObjectId;
  managedBy: mongoose.Types.ObjectId;
  permissions: string[];
  isActive: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StaffProfileSchema = new Schema<IStaffProfile>(
  {
    userId: { type: Schema.Types.ObjectId, unique: true, ref: 'User', required: true },
    managedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    notes: String,
  },
  { timestamps: true }
);
StaffProfileSchema.index({ managedBy: 1 });

export const StaffProfile = mongoose.model<IStaffProfile>('StaffProfile', StaffProfileSchema);

// ───────────────────────────── AUDIT LOG ───────────────────────────────

export interface IAuditLog extends Document {
  userId: mongoose.Types.ObjectId;
  action: string;
  entity: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: String,
    details: Schema.Types.Mixed,
    ipAddress: String,
  },
  { timestamps: true }
);
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ createdAt: 1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

// ───────────────────────────── FEATURE FLAG ───────────────────────────────

export interface IFeatureFlag extends Document {
  feature: string;
  isEnabled: boolean;
  updatedAt: Date;
}

const FeatureFlagSchema = new Schema<IFeatureFlag>(
  {
    feature: { type: String, unique: true, enum: FeatureEnum, required: true },
    isEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const FeatureFlag = mongoose.model<IFeatureFlag>('FeatureFlag', FeatureFlagSchema);

// ───────────────────────────── APP SETTING ───────────────────────────────

export interface IAppSetting extends Document {
  key: string;
  value: any;
  updatedAt: Date;
}

const AppSettingSchema = new Schema<IAppSetting>(
  {
    key: { type: String, unique: true, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const AppSetting = mongoose.model<IAppSetting>('AppSetting', AppSettingSchema);

// ───────────────────────────── PAYMENT LOG ───────────────────────────────

export interface IPaymentLog extends Document {
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  amount: number;
  event?: string;
  paymentStatus: string;
  paymentMethod: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  signatureValid?: boolean | null;
  gatewayResponse?: any;
  ipAddress?: string;
  notes?: string;
  createdAt: Date;
}

const PaymentLogSchema = new Schema<IPaymentLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    amount: { type: Number, required: true },
    event: String,
    paymentStatus: { type: String, enum: PaymentStatusEnum, required: true },
    paymentMethod: { type: String, enum: PaymentMethodEnum, required: true },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    signatureValid: Schema.Types.Mixed,
    gatewayResponse: Schema.Types.Mixed,
    ipAddress: String,
    notes: String,
  },
  { timestamps: true }
);

export const PaymentLog = mongoose.model<IPaymentLog>('PaymentLog', PaymentLogSchema);

// ───────────────────────────── HOME BANNER ───────────────────────────────

export interface IHomeBanner extends Document {
  type?: string;
  title?: string;
  image: string;
  link?: string;
  discount?: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const HomeBannerSchema = new Schema<IHomeBanner>(
  {
    type: String,
    title: String,
    image: { type: String, required: true },
    link: String,
    discount: String,
    description: String,
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const HomeBanner = mongoose.model<IHomeBanner>('HomeBanner', HomeBannerSchema);

// ───────────────────────────── CUSTOMER TRACKER ───────────────────────────────

export interface ICustomerTracker extends Document {
  userId: mongoose.Types.ObjectId;
  pagePath: string;
  action: string;
  createdAt: Date;
}

const CustomerTrackerSchema = new Schema<ICustomerTracker>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pagePath: { type: String, required: true },
    action: { type: String, required: true },
  },
  { timestamps: true }
);

export const CustomerTracker = mongoose.model<ICustomerTracker>('CustomerTracker', CustomerTrackerSchema);

// Aliases for compatibility
export const Attribute = CategoryAttribute;
export const AttributeValue = CategoryAttributeValue;
export const CompanySettings = AppSetting;
export const PasswordReset = TempUpdate;
