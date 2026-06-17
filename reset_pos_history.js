const mongoose = require('mongoose');
const url = 'mongodb+srv://blueprintsoftcloud_db_user:DXO8QGdMnz5jjUPu5@cluster0.wdy7ouf.mongodb.net/boutique_production?appName=Cluster0';

mongoose.connect(url)
  .then(async () => {
    console.log("Connected to database successfully.");
    const result = await mongoose.connection.db.collection('posorders').deleteMany({});
    console.log(`Successfully deleted ${result.deletedCount} old test POS orders.`);
    process.exit(0);
  })
  .catch(err => {
    console.error("Failed to connect or clear database:", err);
    process.exit(1);
  });
