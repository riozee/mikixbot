function x() {
    const { MongoClient } = require('mongodb');

    async function main() {
        let start;
        const uri =
            'mongodb+srv://shiry:shiry123@cluster0.ojru3.mongodb.net/test?retryWrites=true&w=majority';
        const client = new MongoClient(uri);
        try {
            await client.connect();
            const users = client.db().collection('users');
            start = Date.now();
            await users.deleteOne({ u: 'Fioze' });
            const results = await users.find({}).toArray();
            console.log(results);
        } catch (e) {
            console.log(e);
        } finally {
            console.log('time: ' + (Date.now() - start));
            await client.close();
        }
    }

    main().catch(console.error);
}
