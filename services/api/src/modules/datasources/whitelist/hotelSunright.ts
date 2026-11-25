/**
 * Whitelist bảng/cột được phép thao tác trên DB "hotel_dbs" (Intelio_Sunset) —
 * ĐÂY LÀ LỚP CHẶN QUAN TRỌNG NHẤT. Agent/LLM KHÔNG được tự chọn bảng hay cột tuỳ ý,
 * chỉ dùng được đúng những gì khai báo tường minh ở đây.
 *
 * Schema được trích xuất trực tiếp từ DB Intelio_Sunset (MS SQL Server).
 */
export interface TableWhitelistEntry {
  allowedOperations: ("select" | "insert" | "update" | "delete" | "count" | "aggregate")[];
  columns: string[];
  primaryKey: string;
}

export const hotelSunrightWhitelist: Record<string, TableWhitelistEntry> = {
  // 1. Danh sách phòng (Chỉ đọc)
  tbl_Rooms: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "RoomNo",
      "RoomTypeID",
      "RoomDescriptionID",
      "Floor",
      "NotInPlan",
      "POSType",
      "Cost",
      "RoomAddress",
      "GuestStatus",
      "RoS",
      "StartTime",
      "EndTime",
    ],
    primaryKey: "ID",
  },

  // 2. Loại phòng (Chỉ đọc)
  tbl_RoomTypes: {
    allowedOperations: ["select"],
    columns: ["ID", "Code", "Name", "RateHeaderID", "Orders", "OTACode"],
    primaryKey: "ID",
  },

  // 3. Trạng thái phòng (Chỉ đọc)
  tbl_RoomStatus: {
    allowedOperations: ["select"],
    columns: ["ID", "Code", "Name", "Locktable", "FO", "PassNightAudit"],
    primaryKey: "ID",
  },

  // 4. Đơn đặt phòng chi tiết / Reservations (Đọc, Tạo mới, Cập nhật)
  tbl_Reservations: {
    allowedOperations: ["select", "insert", "update"],
    columns: [
      "ID",
      "ResCode",
      "GuestID",
      "GuestTypeID",
      "GroupID",
      "RoomID",
      "RoomNo",
      "Status",
      "FromDate",
      "ToDate",
      "ArrivalDate",
      "DepartureDate",
      "ArrivalTime",
      "DepartureTime",
      "CheckInDate",
      "CheckInTime",
      "Nights",
      "NoAdults",
      "NoChildren",
      "NightRate",
      "TotalRate",
      "DepositPaid",
      "TotalDue",
      "Note",
      "DateCreate",
      "Breakfast",
      "EarlyCheckIn",
      "IsCancel",
      "IsDelete",
      "CompanyID",
      "Discount",
      "RateTypeID",
      "ExtraBedQty",
      "ExtraBedPrice",
      "Extras",
      "CancellationNote",
    ],
    primaryKey: "ID",
  },

  // 5. Booking tổng quan của khách (Đọc, Tạo mới, Cập nhật)
  tbl_GuestBooking: {
    allowedOperations: ["select", "insert", "update"],
    columns: [
      "ID",
      "ResCode",
      "BookingCode",
      "GuestName",
      "ArrivalDate",
      "DepartureDate",
      "Nights",
      "Adults",
      "Children",
      "TotalRooms",
      "Status",
      "BookingStatus",
      "SpecialNote",
      "PaymentMethode",
      "Note",
      "CancellationNote",
      "RoomTypeID",
      "NightRate",
      "GuestID",
      "FirstName",
      "DateCreate",
    ],
    primaryKey: "ID",
  },

  // 6. Thông tin khách lưu trú (Đọc, Tạo mới, Cập nhật)
  tbl_Guests: {
    allowedOperations: ["select", "insert", "update"],
    columns: [
      "ID",
      "Code",
      "FirstName",
      "LastName",
      "Gender",
      "IdentifyNo",
      "Address",
      "Phone",
      "Fax",
      "Mail",
      "CompanyID",
      "NationalityID",
      "CountryID",
      "BirthDay",
      "ExactBirthDay",
      "Job",
      "Note",
      "PersonType",
      "BlackList",
    ],
    primaryKey: "ID",
  },

  // 7. Đặt cọc / Thanh toán trước (Đọc, Tạo mới, Cập nhật)
  tbl_DepositPayment: {
    allowedOperations: ["select", "insert", "update"],
    columns: [
      "ID",
      "ItemID",
      "ResID",
      "DepositNumber",
      "Amount",
      "Paid",
      "CurrencyID",
      "ExchangeRate",
      "DepositDate",
      "DepositTime",
      "StaffID",
      "CustomerName",
      "Address",
      "Note",
      "PaymentID",
      "LinkInvoiceID",
      "TranToID",
      "Accounting",
    ],
    primaryKey: "ID",
  },

  // 8. Hóa đơn bán hàng / Dịch vụ (Chỉ đọc)
  tbl_HoaDonBanHang: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "OrderNo",
      "DateCreate",
      "TimeCreate",
      "NhanVienPV",
      "ResID",
      "KhachHang",
      "SoKhach",
      "TongTien",
      "GiamGia",
      "Conlai",
      "ThanhToan",
      "DIEMBANHANG",
      "GhiChu",
      "TrangThai",
      "LoaiHD",
      "PaymentDate",
    ],
    primaryKey: "ID",
  },

  // 9. Chi tiết thanh toán (Chỉ đọc)
  tbl_PaymentDetail: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "PaymentNo",
      "InvoiceID",
      "InvoiceType",
      "DatePayment",
      "TimePayment",
      "Amount",
      "CurrencyID",
      "ResID",
      "OutLet",
      "GuestID",
    ],
    primaryKey: "ID",
  },

  // 10. Nhân viên (Chỉ đọc)
  tbl_Staff: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "StaffCode",
      "FirstName",
      "LastName",
      "PositionID",
      "DepartmentID",
      "Gender",
      "Email",
      "Phone",
      "Description",
    ],
    primaryKey: "ID",
  },

  // 11. Hàng hóa / Dịch vụ / Minibar (Chỉ đọc)
  tbl_Items: {
    allowedOperations: ["select"],
    columns: ["ID", "Code", "Name", "UnitID", "SourceCategoryID", "Pos", "Status"],
    primaryKey: "ID",
  },

  // 12. Nhật ký thao tác đặt phòng / Check-in / Hủy phòng (Chỉ đọc)
  tbl_LogRes: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "LogDate",
      "LogTime",
      "ClientPC",
      "UserID",
      "UserName",
      "ResID",
      "RoomNo",
      "GuestName",
      "GroupName",
      "CompanyName",
      "CompanyID",
      "LogText",
      "Note",
      "Status",
      "IsDelete",
    ],
    primaryKey: "ID",
  },

  // 13. Công ty / Đại lý du lịch / Khách đoàn (Chỉ đọc)
  tbl_Companies: {
    allowedOperations: ["select"],
    columns: ["ID", "RefNo", "Code", "Name", "NameEN", "CountryID", "Address", "Phone", "Email", "TaxCode", "CompanyType"],
    primaryKey: "ID",
  },

  // 14. Hóa đơn giặt ủi (Chỉ đọc)
  tbl_LaundryInvoice: {
    allowedOperations: ["select"],
    columns: [
      "ID",
      "InvoiceNumber",
      "DateCreate",
      "TimeCreate",
      "StaffID",
      "ResID",
      "SameDayService",
      "RegularService",
      "Service",
      "Total",
      "Paid",
      "BlankDue",
      "CurrencyID",
      "Note",
    ],
    primaryKey: "ID",
  },

  // 15. Hóa đơn dịch vụ khác (Chỉ đọc)
  tbl_HoaDonDichVu: {
    allowedOperations: ["select"],
    columns: ["ID", "SoPhieu", "NgayTao", "GioTao", "CompanyID", "NguoiMuaHang", "TKNo", "TongTien", "CurrencyID", "TyGia", "DienGiai"],
    primaryKey: "ID",
  },

  // 16. Khách liên kết phòng / Khách lưu trú (Chỉ đọc)
  tbl_LinkGuests: {
    allowedOperations: ["select"],
    columns: ["ID", "GuestID", "ResID", "Status", "FromDate", "ToDate", "ArrivalDate", "DepartureDate", "Nights", "ArrivalTime", "DepartureTime", "PersonType", "Manager", "RoomMate"],
    primaryKey: "ID",
  },

  // 17. Quốc tịch (Chỉ đọc)
  tbl_Nationality: {
    allowedOperations: ["select"],
    columns: ["ID", "Code", "NameEN", "NameVN", "ContinentID"],
    primaryKey: "ID",
  },

  // 18. Thông tin đoàn khách (Chỉ đọc)
  tbl_Groups: {
    allowedOperations: ["select"],
    columns: ["ID", "GroupName", "GuestTypeID", "LanguageID", "ContactFirstName", "ContactLastName", "Address", "NationalityID", "CountryID", "Phone", "Email", "CompanyID"],
    primaryKey: "ID",
  },

  // Alias tương thích ngược cho các query ngắn gọn (nếu có)
  rooms: {
    allowedOperations: ["select"],
    columns: ["ID", "RoomNo", "RoomTypeID", "Floor", "GuestStatus", "StartTime", "EndTime"],
    primaryKey: "ID",
  },
  bookings: {
    allowedOperations: ["select", "insert", "update"],
    columns: ["ID", "ResCode", "GuestName", "ArrivalDate", "DepartureDate", "Nights", "TotalRooms", "Status", "Note"],
    primaryKey: "ID",
  },
};
