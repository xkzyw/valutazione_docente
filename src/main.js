const express = require("express");
const { MongoClient } = require("mongodb");
const tokenUtil = require("./token")
const config = require("./config.json")

const app = express();

const LISTEN_PORT = config.port;

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

const mongodb = new MongoClient(`mongodb://${config.host}:27017/Zhou_ValutazioniDocenti`);

app.post("/login", (req, res) => {
    let mail = req.body.mail;
    let token = req.body.token;

    mongodb.connect()
        .then(async (mongoclient) => {
            // Se non ha passato token
            if(token == undefined){
                token = tokenUtil.createToken(16);

                let result = {
                    nome: null,
                    cognome: null,
                    token: null
                };

                let studenti_collection = mongoclient.db().collection("Studenti");
                let token_collection = mongoclient.db().collection("Token");

                // Verifica se token è già precedentemente creato
                let db_token = await token_collection.findOne({mail: mail});

                // Non esiste token nel database
                if(!db_token){
                    // Inserisce una nuova
                    token_collection.insertOne({mail: mail, value: token, valutato: []});
                }else{
                    // Recuperare token del db
                    result.token = db_token.value;
                }

                let studente = await studenti_collection.findOne({mail: mail});

                // Nel caso se mail esiste
                if(studente){
                    result.cognome = studente.cognome;
                    result.nome = studente.nome;
                }

                mongoclient.close();

                res.json(result);
                res.end();
            }
        })

});

app.get("/getDocenti", (req, res) => {
    let plesso = req.query.plesso;
    let classe = req.query.classe;

    mongodb.connect()
        .then(async (mongoclient) => {
            let docenti_collection = mongoclient.db().collection("Docenti");

            let lista_docenti = await docenti_collection.find({plesso: plesso, classe: classe}).toArray();
            mongoclient.close();

            res.json(lista_docenti);
            res.end();
        });
});

app.get("/getDomande", (req, res) => {
    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Domande");

            let lista_domande = await domande_collection.find({}).toArray();
            mongoclient.close();

            res.json(lista_domande);
            res.end();
        });
});

app.get("/valutaDocente", (req, res) => {
    let valutazione = req.body.content || {
        token: "12345",
        cognomeDocente: "Allione",
        nomeDocente: "Giovanna",
        codDocente: "011",
        materie: [
            {
                nomeMateria: "Storia",
                valutazioni:[
                    {
                        domanda: "001",
                        voto: 3
                    },
                    {
                        domanda: "002",
                        voto: 4
                    }
                ]
            }
        ]
    };

    mongodb.connect()
        .then(async (mongoclient) => {
            let voti_collection = mongoclient.db().collection("Voti");
            let token_collection = mongoclient.db().collection("Token");

            let id_docente = valutazione.codDocente;
            let token = valutazione.token;
            let materie = valutazione.materie;

            let docente = await voti_collection.findOne({id_docente: id_docente});

            if(!docente){
                await voti_collection.insertOne({
                    id_docente: id_docente,
                    materie: []
                })
                docente = await voti_collection.findOne({id_docente: id_docente});
            }

            // Per ogni materia valutato inviato dal client 
            materie.forEach((valuta_materia) => {
                // Se è già votato nel database tale materia  
                let mat = docente.materie.find((materia_valutata) => materia_valutata.nome == valuta_materia.nomeMateria);
                if(mat){
                    // Per ogni domanda valutato
                    valuta_materia.valutazioni.forEach((valuta_domanda) => {
                        // Verifico se esiste già la domanda
                        if(mat.valutazioni.find((valutazione_db) => valutazione_db.id_domanda == valuta_domanda.domanda)){
                            voti_collection.updateOne({id_docente: id_docente}, {"$push":{
                                "materie.$[mat].valutazioni.$[val].voto": 
                                    valuta_domanda.voto
                            }}, {
                                arrayFilters:[
                                    {"mat.nome": valuta_materia.nomeMateria},
                                    {"val.id_domanda": valuta_domanda.domanda}
                                ]
                            });
                        }else{
                            // Non esiste nel db la domanda da valutare, quindi lo aggiungo
                            voti_collection.updateOne({id_docente: id_docente}, {"$push":{
                                "materie.$[mat].valutazioni": 
                                    {
                                        id_domanda: valuta_domanda.domanda,
                                        voto: [
                                            valuta_domanda.voto
                                        ]
                                    }
                            }}, {
                                arrayFilters:[
                                    {"mat.nome": valuta_materia.nomeMateria},
                                ]
                            });
                        }
                    })
                }else{
                    // Non esiste la meteria nel db del docente
                    
                    // Creao array delle votazioni
                    let tmp = [];

                    valuta_materia.valutazioni.forEach((valuta_domanda) => {
                        tmp.push({
                            id_domanda: valuta_domanda.domanda,
                            voto: [
                                valuta_domanda.voto
                            ]
                        })
                    });

                    voti_collection.updateOne({id_docente: id_docente}, {"$push":{
                        "materie": 
                            {
                                nome: valuta_materia.nomeMateria,
                                valutazioni:tmp
                            }
                    }});
                }
            });

            // Aggiornare la lista dei docenti valutati
            token_collection.updateOne({value: token}, {$push: {
                valutato: id_docente
            }})
            
            res.end();
        });
});

// app.get("/caricadati", (req, res) => {
//     // let dlist = require("../Valutazione_Docenti/Backend/Json/ProfJSON.json");
//     let dlist = require("../Valutazione_Docenti/Backend/Json/domandeProf.json");

//     mongodb.connect()
//         .then(async (mongoclient) => {
//             // let docente_collection = mongoclient.db().collection("Docenti");

//             // dlist = dlist.map((val) => {
//             //     let tmp = [];

//             //     for(let i = 0; i < val.classi.length; i++){
//             //         tmp.push({
//             //             nome: val.classi[i],
//             //             materie: val.materie[i]
//             //         })
//             //     }

//             //     return {
//             //         id: val.id,
//             //         nome: val.nome,
//             //         cognome: val.cognome,
//             //         istituto: val.istituto,
//             //         classi: tmp
//             //     }
//             // }); 
 
//             // res.end();
//             // console.log(dlist)

//             // docente_collection.insertMany(dlist).finally(() => mongoclient.close());

//             let domande_collection = mongoclient.db().collection("Domande");

//             domande_collection.insertMany(dlist);
//         });
// })

app.listen(LISTEN_PORT, () => {});