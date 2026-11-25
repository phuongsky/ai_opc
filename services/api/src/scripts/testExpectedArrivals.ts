import { getExternalDb } from "../modules/datasources/externalDbClient";

async function main() {
  const db = await getExternalDb("hotel_dbs");
  if (!db) {
    console.log("No hotel_dbs connection");
    return;
  }
  const dateNum = 20261024;
  console.log("=== KIỂM TRA ĐẶT PHÒNG NGÀY", dateNum, "===");

  const res = await db("tbl_Reservations")
    .where(function() {
      this.where("ArrivalDate", dateNum).orWhere("FromDate", dateNum);
    })
    .where("IsCancel", 0)
    .where("IsDelete", 0)
    .select("*");

  console.log(`Tìm thấy ${res.length} đơn đặt phòng cho ngày ${dateNum}:`);
  for (const r of res) {
    let guestName = "";
    let nationality = "Viet Nam";
    if (r.GuestID) {
      const g = await db("tbl_Guests").where("ID", r.GuestID).first();
      if (g) {
        guestName = `${g.FirstName || ""} ${g.LastName || ""}`.trim();
        if (g.NationalityID) {
          const nat = await db("tbl_Nationality").where("ID", g.NationalityID).first();
          if (nat) {
            nationality = nat.NameEN || nat.NameVN || "Viet Nam";
          }
        }
      }
    }

    let companyName = "WALK-IN";
    if (r.CompanyID) {
      const c = await db("tbl_Companies").where("ID", r.CompanyID).first();
      if (c && c.Name) companyName = c.Name.trim();
    }

    let roomTypeName = "Suite DB";
    if (r.RoomID) {
      const rm = await db("tbl_Rooms").where("ID", r.RoomID).first();
      if (rm && rm.RoomTypeID) {
        const rt = await db("tbl_RoomTypes").where("ID", rm.RoomTypeID).first();
        if (rt) roomTypeName = rt.Name || "";
      }
    }

    console.log({
      RoomNo: r.RoomNo,
      RoomType: roomTypeName,
      ArrivalDate: r.ArrivalDate,
      DepartureDate: r.DepartureDate,
      FromDate: r.FromDate,
      ToDate: r.ToDate,
      Nights: r.Nights,
      GuestName: guestName,
      Company: companyName,
      Nationality: nationality,
      Status: r.Status,
      Note: r.Note,
    });
  }
}

main().catch(console.error);
